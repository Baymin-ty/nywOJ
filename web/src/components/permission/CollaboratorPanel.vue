<template>
  <el-card class="box-card" shadow="hover" v-loading="loading">
    <template #header>
      <div class="card-header">
        <span>协作者权限</span>
        <el-tag size="small" type="info">{{ resourceType }} #{{ resourceId }}</el-tag>
      </div>
    </template>

    <div v-if="!visible" style="color:#909399;">无权限查看本资源的协作者。</div>
    <div v-else>
      <div v-if="!canEdit" style="font-size:12px;color:#909399;margin-bottom:10px;">
        以下是当前协作者列表。仅资源所有者可以新增/移除协作者。
      </div>
      <el-table :data="grants" :cell-style="{ textAlign: 'center' }" :header-cell-style="{ textAlign: 'center' }">
        <el-table-column label="用户" width="200">
          <template #default="scope">
            <router-link :to="'/user/' + scope.row.uid" class="rlink">{{ scope.row.name }} (#{{ scope.row.uid }})</router-link>
          </template>
        </el-table-column>
        <el-table-column v-if="showPermissionColumn" label="权限">
          <template #default="scope">
            <el-tag size="small">{{ permName(scope.row.permissionKey) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="过期" width="180">
          <template #default="scope">
            <span v-if="scope.row.expiresAt">{{ formatDate(scope.row.expiresAt) }}</span>
            <span v-else style="color:#909399">永久</span>
          </template>
        </el-table-column>
        <el-table-column v-if="canEdit" label="操作" width="100">
          <template #default="scope">
            <el-button type="danger" size="small" plain @click="revoke(scope.row)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <template v-if="canEdit">
        <el-divider>添加协作者</el-divider>
        <el-form :inline="true">
          <el-form-item label="用户">
            <UserPicker v-model="form.uid" style="width: 240px;" />
          </el-form-item>
          <el-form-item v-if="showPermissionPicker" label="权限">
            <PermissionPicker
              v-model="form.permissionKey"
              :permissions="displayPermissions"
              :whitelist="grantablePermissions"
              scopable-only
              hide-key
              style="width: 240px;"
            />
          </el-form-item>
          <el-form-item label="过期">
            <el-date-picker v-model="form.expiresAt" type="datetime" placeholder="（永久）" style="width: 200px;" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="granting" @click="grant">添加</el-button>
          </el-form-item>
        </el-form>
      </template>
    </div>
  </el-card>
</template>

<script>
import axios from 'axios';
import { ElMessageBox } from 'element-plus';
import UserPicker from './UserPicker.vue';
import PermissionPicker from './PermissionPicker.vue';

export default {
  name: 'CollaboratorPanel',
  components: { UserPicker, PermissionPicker },
  props: {
    resourceType: { type: String, required: true },   // 'problem' | 'contest'
    resourceId: { type: Number, required: true },
    // `visible` controls whether the collaborator LIST is shown (owner +
    // collaborators + global grantors can read).
    visible: { type: Boolean, default: true },
    // `canEdit` controls whether the add/remove form is shown. ONLY the
    // resource owner (or a global grantor) may modify the collaborator list —
    // a collaborator with manage.any scoped on this resource cannot grant or
    // revoke other collaborators. Server enforces the same rule.
    canEdit: { type: Boolean, default: false },
  },
  data() {
    return {
      loading: false,
      granting: false,
      grants: [],
      grantablePermissions: [],
      permissions: [],
      form: { uid: null, permissionKey: null, expiresAt: null },
    };
  },
  computed: {
    showPermissionColumn() {
      return this.resourceType !== 'contest';
    },
    showPermissionPicker() {
      return this.grantablePermissions.length > 1;
    },
    singleGrantable() {
      return this.grantablePermissions.length === 1 ? this.grantablePermissions[0] : null;
    },
    // The permissions catalog returned by the server uses the global names
    // (e.g. "管理任意题目"), which read as confusing in a single-resource
    // collaborator UI. Re-label per-resource so the picker shows e.g.
    // "管理本题目" / "查看本题目".
    displayPermissions() {
      return (this.permissions || []).map((p) => ({
        ...p,
        name: this.permName(p.key) || p.name,
      }));
    },
  },
  watch: {
    resourceId() { this.reload(); },
    visible(v) { if (v) this.reload(); },
  },
  mounted() {
    if (this.visible) this.reload();
  },
  methods: {
    permName(key) {
      if (this.resourceType === 'problem' && key === 'problem.manage.any') return '管理本题目';
      if (this.resourceType === 'problem' && key === 'problem.view.any') return '查看本题目';
      if (this.resourceType === 'contest' && key === 'contest.manage.any') return '管理本比赛';
      const p = this.permissions.find((x) => x.key === key);
      return p ? p.name : key;
    },
    formatDate(v) {
      if (!v) return '';
      const d = new Date(v);
      const pad = (n) => (n < 10 ? '0' + n : n);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
    async reload() {
      if (!this.resourceId) return;
      this.loading = true;
      try {
        const gr = await axios.post('/api/auth/listResourceGrants', {
          resourceType: this.resourceType,
          resourceId: this.resourceId,
        });
        this.permissions = (gr.data && gr.data.permissions) || [];
        if (gr.status === 200) {
          this.grants = gr.data.grants || [];
          this.grantablePermissions = gr.data.grantablePermissions || [];
          if (this.singleGrantable && this.form.permissionKey !== this.singleGrantable) {
            this.form.permissionKey = this.singleGrantable;
          }
          if (!this.singleGrantable && this.form.permissionKey &&
            !this.grantablePermissions.includes(this.form.permissionKey)) {
            this.form.permissionKey = null;
          }
        } else if (gr.status !== 403) {
          this.$message.error(gr.data && gr.data.message || '加载失败');
        }
      } catch (e) {
        if (e.response && e.response.status === 403) {
          this.grants = [];
        } else {
          this.$message.error(e.message || '加载失败');
        }
      } finally {
        this.loading = false;
      }
    },
    async grant() {
      if (!this.form.uid) { this.$message.error('请选择用户'); return; }
      if (!this.form.permissionKey && this.singleGrantable) {
        this.form.permissionKey = this.singleGrantable;
      }
      if (!this.form.permissionKey) { this.$message.error('请选择权限'); return; }
      this.granting = true;
      try {
        const res = await axios.post('/api/auth/grantUserPermission', {
          uid: this.form.uid,
          permissionKey: this.form.permissionKey,
          effect: 'allow',
          resourceType: this.resourceType,
          resourceId: this.resourceId,
          expiresAt: this.form.expiresAt || null,
        });
        if (res.status === 200) {
          this.$message.success('已添加');
          this.form = { uid: null, permissionKey: null, expiresAt: null };
          await this.reload();
        } else {
          this.$message.error(res.data && res.data.message || '添加失败');
        }
      } catch (e) {
        this.$message.error(e.message || '添加失败');
      } finally {
        this.granting = false;
      }
    },
    async revoke(row) {
      try {
        const permText = this.showPermissionColumn
          ? ` 的 ${this.permName(row.permissionKey)}`
          : ' 的协作者';
        await ElMessageBox.confirm(`确认移除 ${row.name}${permText} 权限？`, '提示', { type: 'warning' });
      } catch (_) { return; }
      try {
        const res = await axios.post('/api/auth/revokeUserPermission', { id: row.id });
        if (res.status === 200) { this.$message.success('已移除'); await this.reload(); }
        else this.$message.error(res.data && res.data.message || '移除失败');
      } catch (e) {
        this.$message.error(e.message || '移除失败');
      }
    },
  },
};
</script>

<style scoped>
.box-card { margin: 10px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.rlink { color: #409eff; text-decoration: none; }
</style>
