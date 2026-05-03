<template>
  <div>
    <el-table :data="grants" :cell-style="{ textAlign: 'center' }" :header-cell-style="{ textAlign: 'center' }">
      <el-table-column label="权限" prop="permissionKey">
        <template #default="scope">
          <el-tag size="small">{{ permName(scope.row.permissionKey) }}</el-tag>
          <div style="font-size: 12px; color: #909399;">{{ scope.row.permissionKey }}</div>
        </template>
      </el-table-column>
      <el-table-column label="效果" width="100">
        <template #default="scope">
          <el-tag :type="scope.row.effect === 'deny' ? 'danger' : 'success'" size="small">
            {{ scope.row.effect === 'deny' ? '拒绝' : '允许' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="资源作用域" width="180">
        <template #default="scope">
          <span v-if="scope.row.resourceType">
            {{ scope.row.resourceType }} #{{ scope.row.resourceId }}
          </span>
          <span v-else style="color:#909399">全局</span>
        </template>
      </el-table-column>
      <el-table-column label="过期时间" width="180">
        <template #default="scope">
          <span v-if="scope.row.expiresAt">{{ formatDate(scope.row.expiresAt) }}</span>
          <span v-else style="color:#909399">永久</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100">
        <template #default="scope">
          <el-button type="danger" size="small" plain @click="onRevoke(scope.row)">撤销</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-divider>新增授权</el-divider>

    <el-form :inline="true" :model="form" @submit.prevent="onGrant">
      <el-form-item label="权限">
        <PermissionPicker
          v-model="form.permissionKey"
          :permissions="permissions"
          :whitelist="whitelist"
          :scopable-only="scopedOnly || !!form.resourceType"
          :placeholder="form.resourceType ? '只显示可作用域的权限' : '选择权限'"
          style="width: 260px;"
        />
      </el-form-item>
      <el-form-item label="效果" v-if="!scopedOnly || allowDeny">
        <el-select v-model="form.effect" style="width: 100px;">
          <el-option label="允许" value="allow" />
          <el-option label="拒绝" value="deny" />
        </el-select>
      </el-form-item>
      <template v-if="!fixedScope">
        <el-form-item label="资源类型">
          <el-select v-model="form.resourceType" clearable placeholder="（全局）" style="width: 130px;"
            @change="form.resourceId = null">
            <el-option label="题目" value="problem" />
            <el-option label="比赛" value="contest" />
          </el-select>
        </el-form-item>
        <el-form-item :label="form.resourceType === 'contest' ? '比赛' : '题目'" v-if="form.resourceType">
          <ResourcePicker v-model="form.resourceId" :resource-type="form.resourceType" style="width: 260px;" />
        </el-form-item>
      </template>
      <el-form-item label="过期">
        <el-date-picker v-model="form.expiresAt" type="datetime" placeholder="（永久）" style="width: 200px;" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="granting" @click="onGrant">授予</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script>
import axios from 'axios';
import { ElMessageBox } from 'element-plus';
import PermissionPicker from './PermissionPicker.vue';
import ResourcePicker from './ResourcePicker.vue';

const formDefaults = (fixedScope) => ({
  permissionKey: null,
  effect: 'allow',
  resourceType: fixedScope ? fixedScope.type : null,
  resourceId: fixedScope ? fixedScope.id : null,
  expiresAt: null,
});

export default {
  name: 'GrantTable',
  components: { PermissionPicker, ResourcePicker },
  props: {
    uid: { type: Number, required: true },
    grants: { type: Array, required: true },
    permissions: { type: Array, required: true },
    whitelist: { type: Array, default: null },
    fixedScope: { type: Object, default: null },     // { type, id } when used inside resource page
    scopedOnly: { type: Boolean, default: false },   // hide non-scopable perms
    allowDeny: { type: Boolean, default: true },
  },
  emits: ['changed'],
  data() {
    return { form: formDefaults(this.fixedScope), granting: false };
  },
  watch: {
    fixedScope: {
      handler(v) { this.form = formDefaults(v); },
      deep: true,
    },
  },
  methods: {
    permName(key) {
      const p = this.permissions.find((x) => x.key === key);
      return p ? p.name : key;
    },
    formatDate(v) {
      if (!v) return '';
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return v;
      const pad = (n) => (n < 10 ? '0' + n : n);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
    async onGrant() {
      if (!this.form.permissionKey) { this.$message.error('请选择权限'); return; }
      if (this.form.resourceType && this.form.resourceId == null) {
        this.$message.error('请填写资源 ID'); return;
      }
      this.granting = true;
      try {
        const res = await axios.post('/api/auth/grantUserPermission', {
          uid: this.uid,
          permissionKey: this.form.permissionKey,
          effect: this.form.effect,
          resourceType: this.form.resourceType || null,
          resourceId: this.form.resourceType ? this.form.resourceId : null,
          expiresAt: this.form.expiresAt || null,
        });
        if (res.status === 200) {
          this.$message.success('授权成功');
          this.form = formDefaults(this.fixedScope);
          this.$emit('changed');
        } else {
          this.$message.error(res.data && res.data.message || '授权失败');
        }
      } catch (e) {
        this.$message.error(e.message || '授权失败');
      } finally {
        this.granting = false;
      }
    },
    async onRevoke(row) {
      try {
        await ElMessageBox.confirm('确认撤销此授权？', '提示', { type: 'warning' });
      } catch (_) { return; }
      try {
        const res = await axios.post('/api/auth/revokeUserPermission', { id: row.id });
        if (res.status === 200) {
          this.$message.success('已撤销');
          this.$emit('changed');
        } else {
          this.$message.error(res.data && res.data.message || '撤销失败');
        }
      } catch (e) {
        this.$message.error(e.message || '撤销失败');
      }
    },
  },
};
</script>
