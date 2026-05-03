<template>
  <div style="margin: 10px auto; max-width: 1200px;">
    <el-card shadow="hover" v-loading="loading">
      <template #header>
        <div class="card-header">
          <span>权限管理中心</span>
          <el-button type="primary" plain @click="reloadAll">刷新</el-button>
        </div>
      </template>

      <el-tabs v-model="activeTab">
        <!-- A2: 用户授权 -->
        <el-tab-pane label="用户授权" name="userGrants">
          <el-form :inline="true">
            <el-form-item label="选择用户">
              <UserPicker v-model="pickedUid" style="width: 320px;" @change="onUserPicked" />
            </el-form-item>
            <el-form-item v-if="pickedUid">
              <el-button @click="loadUserGrants">重新加载</el-button>
            </el-form-item>
          </el-form>

          <div v-if="!pickedUid" style="color:#909399; padding: 20px;">请选择一个用户。</div>

          <div v-else>
            <el-descriptions :column="2" border>
              <el-descriptions-item label="uid">{{ userInfo.uid }}</el-descriptions-item>
              <el-descriptions-item label="用户名">{{ userInfo.name }}</el-descriptions-item>
            </el-descriptions>

            <el-divider>角色</el-divider>
            <el-checkbox-group v-model="userRoleKeys">
              <el-checkbox
                v-for="r in roles"
                :key="r.key"
                :label="r.key"
                :disabled="!canAssignRoles"
              >
                <span>{{ r.name }}</span>
                <el-tag size="small" v-if="r.builtin" style="margin-left:6px">内置</el-tag>
                <span style="color:#909399;font-size:12px;margin-left:4px;">({{ r.key }})</span>
              </el-checkbox>
            </el-checkbox-group>
            <div style="margin-top: 10px;">
              <el-button type="primary" :disabled="!canAssignRoles || rolesDirty === false" :loading="savingRoles" @click="saveRoles">保存角色</el-button>
              <span v-if="rolesDirty" style="color:#e6a23c; margin-left: 8px;">已修改未保存</span>
            </div>

            <el-divider>直接授权</el-divider>
            <GrantTable
              v-if="canGrantPerm"
              :uid="userInfo.uid"
              :grants="userPermissions"
              :permissions="permissions"
              @changed="loadUserGrants"
            />
            <div v-else style="color:#909399;">需要 user.permission.grant 权限以管理直接授权。</div>
          </div>
        </el-tab-pane>

        <!-- A1: 角色管理 -->
        <el-tab-pane label="角色管理" name="roles">
          <div style="margin-bottom: 10px;">
            <el-button type="primary" :disabled="!canAssignRoles" @click="openCreateRole">+ 新建角色</el-button>
          </div>
          <el-table :data="roles" :cell-style="{ textAlign: 'center' }" :header-cell-style="{ textAlign: 'center' }">
            <el-table-column label="key" prop="key" width="180" />
            <el-table-column label="名称" prop="name" width="160" />
            <el-table-column label="说明" prop="description" />
            <el-table-column label="类型" width="100">
              <template #default="scope">
                <el-tag size="small" v-if="scope.row.builtin">内置</el-tag>
                <el-tag size="small" type="info" v-else>自定义</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="权限数" width="90">
              <template #default="scope">{{ (scope.row.permissions || []).length }}</template>
            </el-table-column>
            <el-table-column label="操作" width="200">
              <template #default="scope">
                <el-button size="small" plain @click="openEditRole(scope.row)" :disabled="scope.row.builtin || !canAssignRoles">编辑</el-button>
                <el-button size="small" plain type="danger" :disabled="scope.row.builtin || !canAssignRoles" @click="deleteRole(scope.row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <RoleEditor
            v-model="roleEditorVisible"
            :role="editingRole"
            :permissions="permissions"
            @saved="onRoleSaved"
          />
        </el-tab-pane>

        <!-- A3: 权限目录 -->
        <el-tab-pane label="权限目录" name="catalog">
          <el-table :data="permissions" :cell-style="{ textAlign: 'center' }" :header-cell-style="{ textAlign: 'center' }">
            <el-table-column label="分组" prop="group" width="100" />
            <el-table-column label="key" prop="key" width="260" />
            <el-table-column label="名称" prop="name" width="180" />
            <el-table-column label="说明" prop="description" />
            <el-table-column label="可作用域" width="100">
              <template #default="scope">
                <el-tag size="small" v-if="scope.row.scopable" type="success">可</el-tag>
                <el-tag size="small" v-else type="info">否</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script>
import axios from 'axios';
import { ElMessageBox } from 'element-plus';
import UserPicker from '@/components/permission/UserPicker.vue';
import GrantTable from '@/components/permission/GrantTable.vue';
import RoleEditor from '@/components/permission/RoleEditor.vue';
import { can } from '@/utils/can';

export default {
  name: 'PermissionCenter',
  components: { UserPicker, GrantTable, RoleEditor },
  data() {
    return {
      loading: false,
      activeTab: 'userGrants',
      permissions: [],
      roles: [],
      pickedUid: null,
      userInfo: { uid: 0, name: '' },
      userRoleKeys: [],
      originalRoleKeys: [],
      userPermissions: [],
      savingRoles: false,
      roleEditorVisible: false,
      editingRole: null,
    };
  },
  computed: {
    canAssignRoles() { return can('user.role.assign'); },
    canGrantPerm() { return can('user.permission.grant'); },
    rolesDirty() {
      const a = [...this.userRoleKeys].sort();
      const b = [...this.originalRoleKeys].sort();
      if (a.length !== b.length) return true;
      return a.some((k, i) => k !== b[i]);
    },
  },
  async mounted() {
    const q = this.$route.query || {};
    if (q.tab) this.activeTab = q.tab;
    await this.reloadAll();
    if (q.uid) {
      this.pickedUid = parseInt(q.uid, 10);
      await this.loadUserGrants();
    }
  },
  methods: {
    async reloadAll() {
      this.loading = true;
      try {
        const [pr, rr] = await Promise.all([
          axios.post('/api/auth/listPermissions'),
          axios.post('/api/auth/listRoles'),
        ]);
        this.permissions = (pr.data && pr.data.permissions) || [];
        this.roles = (rr.data && rr.data.roles) || [];
      } catch (e) {
        this.$message.error(e.message || '加载失败');
      } finally {
        this.loading = false;
      }
    },
    onUserPicked(picked) {
      if (picked) this.loadUserGrants();
      else { this.userInfo = { uid: 0, name: '' }; this.userRoleKeys = []; this.userPermissions = []; }
    },
    async loadUserGrants() {
      if (!this.pickedUid) return;
      try {
        const res = await axios.post('/api/auth/listUserGrants', { uid: this.pickedUid });
        if (res.status !== 200) { this.$message.error(res.data && res.data.message || '加载失败'); return; }
        this.userInfo = res.data.user || { uid: this.pickedUid, name: '' };
        this.userRoleKeys = res.data.roles || [];
        this.originalRoleKeys = [...this.userRoleKeys];
        this.userPermissions = res.data.permissions || [];
      } catch (e) {
        this.$message.error(e.message || '加载失败');
      }
    },
    async saveRoles() {
      this.savingRoles = true;
      try {
        const res = await axios.post('/api/auth/setUserRoles', {
          uid: this.userInfo.uid,
          roleKeys: this.userRoleKeys,
        });
        if (res.status === 200) {
          this.$message.success('已保存');
          this.originalRoleKeys = [...this.userRoleKeys];
        } else {
          this.$message.error(res.data && res.data.message || '保存失败');
        }
      } catch (e) {
        this.$message.error(e.message || '保存失败');
      } finally {
        this.savingRoles = false;
      }
    },
    openCreateRole() { this.editingRole = null; this.roleEditorVisible = true; },
    openEditRole(role) { this.editingRole = role; this.roleEditorVisible = true; },
    async onRoleSaved() { await this.reloadAll(); },
    async deleteRole(role) {
      try {
        await ElMessageBox.confirm(`确认删除自定义角色 ${role.key}？`, '提示', { type: 'warning' });
      } catch (_) { return; }
      try {
        const res = await axios.post('/api/auth/deleteRole', { key: role.key });
        if (res.status === 200) { this.$message.success('已删除'); await this.reloadAll(); }
        else this.$message.error(res.data && res.data.message || '删除失败');
      } catch (e) {
        this.$message.error(e.message || '删除失败');
      }
    },
  },
};
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
