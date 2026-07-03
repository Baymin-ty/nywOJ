<template>
  <div class="group-page">
    <header class="page-head">
      <div>
        <div class="eyebrow">ADMIN</div>
        <h1>用户组</h1>
      </div>
      <div class="head-actions">
        <template v-if="canManage">
          <el-input v-model="newGroupName" class="group-name-input" placeholder="新用户组名称" @keyup.enter="createGroup" />
          <el-button type="success" @click="createGroup">
            <el-icon class="el-icon--left"><Plus /></el-icon>
            创建
          </el-button>
        </template>
        <el-button plain @click="loadGroups">
          <el-icon class="el-icon--left"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </header>

    <section class="panel">
      <div class="panel-title">
        <el-icon><UserFilled /></el-icon>
        用户组列表
      </div>
      <div class="panel-body">
        <el-empty v-if="!groups.length && loaded" description="暂无用户组" />
        <el-collapse v-else v-model="activeGroups" @change="onOpenGroups">
        <el-collapse-item v-for="g in groups" :key="g.gid" :name="g.gid">
          <template #title>
            <div class="group-title">
              <span class="group-name">{{ g.name }}</span>
              <el-tag size="small" type="info">{{ g.memberCnt }} 人</el-tag>
              <el-tag v-if="g.isAdmin" size="small" type="success">可管理</el-tag>
            </div>
          </template>

          <div class="group-body">
            <div class="member-panel">
              <div class="panel-head">
                <span>成员</span>
                <div v-if="g.isAdmin" class="member-add">
                  <UserPicker v-model="pickedUsers[g.gid]" placeholder="搜索用户加入组" @change="(u) => addMember(g, u)" />
                </div>
              </div>

              <el-table :data="members[g.gid] || []" :header-cell-style="{ textAlign: 'center' }"
                :cell-style="{ textAlign: 'center' }" v-loading="loadingMembers[g.gid]">
                <el-table-column label="用户" min-width="180px">
                  <template #default="scope">
                    <span class="member-user">
                      <el-avatar :size="24" :src="scope.row.avatar" />
                      <router-link class="rlink" :to="'/user/' + scope.row.uid">
                        {{ scope.row.name }} (#{{ scope.row.uid }})
                      </router-link>
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="组管理员" width="140px">
                  <template #default="scope">
                    <el-switch
                      v-model="scope.row.isAdmin"
                      :disabled="!canManage"
                      @change="(v) => setGroupAdmin(g, scope.row, v)"
                    />
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="130px">
                  <template #default="scope">
                    <el-popconfirm
                      v-if="g.isAdmin"
                      confirm-button-text="确认"
                      cancel-button-text="取消"
                      title="确认移除成员?"
                      @confirm="removeMember(g, scope.row)"
                    >
                      <template #reference>
                        <el-button link type="danger" :disabled="scope.row.isAdmin">移除</el-button>
                      </template>
                    </el-popconfirm>
                  </template>
                </el-table-column>
              </el-table>
            </div>

            <div v-if="canManage" class="admin-panel">
              <el-tabs model-value="grant">
                <el-tab-pane label="组权限" name="grant">
                  <div class="grant-form">
                    <PermissionPicker
                      v-model="grantForms[g.gid].permissionKey"
                      :permissions="grantData[g.gid]?.permissions || []"
                      placeholder="选择权限"
                      @change="() => onPermissionChange(g.gid)"
                    />
                    <el-select v-model="grantForms[g.gid].effect" class="effect-select">
                      <el-option label="允许" value="allow" />
                      <el-option label="拒绝" value="deny" />
                    </el-select>
                    <el-select v-if="selectedPermission(g.gid)?.scopable" v-model="grantForms[g.gid].resourceType" class="resource-type" placeholder="作用域">
                      <el-option label="题目" value="problem" />
                      <el-option label="比赛" value="contest" />
                    </el-select>
                    <ResourcePicker
                      v-if="selectedPermission(g.gid)?.scopable && grantForms[g.gid].resourceType"
                      v-model="grantForms[g.gid].resourceId"
                      :resource-type="grantForms[g.gid].resourceType"
                      class="resource-picker"
                    />
                    <el-button type="primary" @click="grantPermission(g)">
                      <el-icon class="el-icon--left"><Plus /></el-icon>
                      授权
                    </el-button>
                  </div>
                  <el-table :data="grantData[g.gid]?.grants || []" height="260px" :header-cell-style="{ textAlign: 'center' }"
                    :cell-style="{ textAlign: 'center' }" v-loading="loadingGrants[g.gid]">
                    <el-table-column prop="permissionKey" label="权限" min-width="190px" />
                    <el-table-column prop="effect" label="效果" width="80px">
                      <template #default="scope">
                        <el-tag :type="scope.row.effect === 'allow' ? 'success' : 'danger'">
                          {{ scope.row.effect === 'allow' ? '允许' : '拒绝' }}
                        </el-tag>
                      </template>
                    </el-table-column>
                    <el-table-column label="作用域" min-width="130px">
                      <template #default="scope">
                        <span v-if="scope.row.resourceType">{{ scope.row.resourceType }} #{{ scope.row.resourceId }}</span>
                        <span v-else class="muted">全局</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="操作" width="90px">
                      <template #default="scope">
                        <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认撤销组权限?" @confirm="revokePermission(g, scope.row)">
                          <template #reference>
                            <el-button link type="danger">撤销</el-button>
                          </template>
                        </el-popconfirm>
                      </template>
                    </el-table-column>
                  </el-table>
                </el-tab-pane>
                <el-tab-pane label="组设置" name="settings">
                  <div class="settings-row">
                    <el-input v-model="renameForms[g.gid]" placeholder="新的用户组名称" />
                    <el-button type="primary" @click="renameGroup(g)">重命名</el-button>
                    <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认删除用户组? 成员和组权限都会删除。" @confirm="deleteGroup(g)">
                      <template #reference>
                        <el-button type="danger">删除组</el-button>
                      </template>
                    </el-popconfirm>
                  </div>
                </el-tab-pane>
              </el-tabs>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
      </div>
    </section>
  </div>
</template>

<script>
import axios from 'axios';
import UserPicker from '@/components/permission/UserPicker.vue';
import PermissionPicker from '@/components/permission/PermissionPicker.vue';
import ResourcePicker from '@/components/permission/ResourcePicker.vue';

const defaultGrantForm = () => ({
  permissionKey: null,
  effect: 'allow',
  resourceType: null,
  resourceId: null,
});

export default {
  name: 'groupManage',
  components: { UserPicker, PermissionPicker, ResourcePicker },
  data() {
    return {
      groups: [],
      loaded: false,
      canManage: false,
      newGroupName: '',
      activeGroups: [],
      members: {},
      loadingMembers: {},
      pickedUsers: {},
      grantData: {},
      loadingGrants: {},
      grantForms: {},
      renameForms: {},
    };
  },
  methods: {
    apiOk(res) {
      return res.status === 200 && !(res.data && res.data.error);
    },
    apiMessage(res, fallback) {
      return (res.data && (res.data.message || res.data.error)) || fallback;
    },
    async loadGroups() {
      const res = await axios.post('/api/group/getGroupList');
      if (this.apiOk(res)) {
        this.groups = res.data.groups || [];
        this.canManage = !!res.data.canManage;
        for (const g of this.groups) this.ensureGroupState(g);
        this.loaded = true;
      } else {
        this.$message.error(this.apiMessage(res, '加载用户组失败'));
      }
    },
    ensureGroupState(g) {
      if (!this.grantForms[g.gid]) this.grantForms[g.gid] = defaultGrantForm();
      if (!this.renameForms[g.gid]) this.renameForms[g.gid] = g.name;
      if (this.pickedUsers[g.gid] === undefined) this.pickedUsers[g.gid] = null;
    },
    onOpenGroups(names) {
      const list = Array.isArray(names) ? names : [names];
      for (const gid of list) {
        const g = this.groups.find((x) => x.gid === gid);
        if (!g) continue;
        this.ensureGroupState(g);
        if (!this.members[gid]) this.loadMembers(g);
        if (this.canManage && !this.grantData[gid]) this.loadGrants(g);
      }
    },
    async createGroup() {
      const name = this.newGroupName.trim();
      if (!name) return;
      const res = await axios.post('/api/group/createGroup', { name });
      if (this.apiOk(res)) {
        this.$message.success('用户组已创建');
        this.newGroupName = '';
        await this.loadGroups();
      } else {
        this.$message.error(this.apiMessage(res, '创建失败'));
      }
    },
    async renameGroup(g) {
      const name = (this.renameForms[g.gid] || '').trim();
      if (!name) return;
      const res = await axios.post('/api/group/renameGroup', { gid: g.gid, name });
      if (this.apiOk(res)) {
        this.$message.success('用户组已重命名');
        g.name = name;
      } else {
        this.$message.error(this.apiMessage(res, '重命名失败'));
      }
    },
    async deleteGroup(g) {
      const res = await axios.post('/api/group/deleteGroup', { gid: g.gid });
      if (this.apiOk(res)) {
        this.$message.success('用户组已删除');
        this.groups = this.groups.filter((x) => x.gid !== g.gid);
      } else {
        this.$message.error(this.apiMessage(res, '删除失败'));
      }
    },
    async loadMembers(g) {
      this.loadingMembers[g.gid] = true;
      try {
        const res = await axios.post('/api/group/getGroupMemberList', { gid: g.gid });
        if (this.apiOk(res)) {
          this.members = { ...this.members, [g.gid]: res.data.memberList || [] };
        } else {
          this.$message.error(this.apiMessage(res, '加载成员失败'));
        }
      } finally {
        this.loadingMembers[g.gid] = false;
      }
    },
    async addMember(g, user) {
      if (!user) return;
      const res = await axios.post('/api/group/addMember', { gid: g.gid, uid: user.uid });
      if (this.apiOk(res)) {
        this.$message.success('成员已添加');
        this.pickedUsers[g.gid] = null;
        await this.loadMembers(g);
        g.memberCnt += 1;
      } else {
        this.$message.error(this.apiMessage(res, '添加失败'));
      }
    },
    async removeMember(g, member) {
      const res = await axios.post('/api/group/removeMember', { gid: g.gid, uid: member.uid });
      if (this.apiOk(res)) {
        this.$message.success('成员已移除');
        this.members = { ...this.members, [g.gid]: (this.members[g.gid] || []).filter((m) => m.uid !== member.uid) };
        g.memberCnt = Math.max(0, g.memberCnt - 1);
      } else {
        this.$message.error(this.apiMessage(res, '移除失败'));
        this.loadMembers(g);
      }
    },
    async setGroupAdmin(g, member, value) {
      const res = await axios.post('/api/group/setGroupAdmin', { gid: g.gid, uid: member.uid, isAdmin: !!value });
      if (this.apiOk(res)) {
        this.$message.success('组管理员已更新');
      } else {
        this.$message.error(this.apiMessage(res, '更新失败'));
        member.isAdmin = !value;
      }
    },
    async loadGrants(g) {
      this.loadingGrants[g.gid] = true;
      try {
        const res = await axios.post('/api/group/listGroupGrants', { gid: g.gid });
        if (res.status === 200) {
          this.grantData = { ...this.grantData, [g.gid]: { grants: res.data.grants || [], permissions: res.data.permissions || [] } };
        } else {
          this.$message.error(res.data.message || '加载组权限失败');
        }
      } finally {
        this.loadingGrants[g.gid] = false;
      }
    },
    selectedPermission(gid) {
      const data = this.grantData[gid];
      const form = this.grantForms[gid] || {};
      return data && (data.permissions || []).find((p) => p.key === form.permissionKey);
    },
    onPermissionChange(gid) {
      const p = this.selectedPermission(gid);
      if (!p || !p.scopable) {
        this.grantForms[gid].resourceType = null;
        this.grantForms[gid].resourceId = null;
      }
    },
    async grantPermission(g) {
      const form = this.grantForms[g.gid];
      if (!form.permissionKey) return this.$message.error('请选择权限');
      const p = this.selectedPermission(g.gid);
      if (p && p.scopable && (!form.resourceType || !form.resourceId)) return this.$message.error('请选择作用域资源');
      const res = await axios.post('/api/group/grantGroupPermission', {
        gid: g.gid,
        permissionKey: form.permissionKey,
        effect: form.effect,
        resourceType: form.resourceType,
        resourceId: form.resourceId,
      });
      if (res.status === 200) {
        this.$message.success('组权限已授予');
        this.grantForms[g.gid] = defaultGrantForm();
        await this.loadGrants(g);
      } else {
        this.$message.error(res.data.message || '授权失败');
      }
    },
    async revokePermission(g, grant) {
      const res = await axios.post('/api/group/revokeGroupPermission', { id: grant.id });
      if (res.status === 200) {
        this.$message.success('组权限已撤销');
        await this.loadGrants(g);
      } else {
        this.$message.error(res.data.message || '撤销失败');
      }
    },
  },
  async mounted() {
    document.title = '用户组';
    await this.loadGroups();
  },
};
</script>

<style scoped>
.group-page {
  max-width: 1250px;
  margin: 18px auto;
  padding: 0 14px 30px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.eyebrow {
  color: #909399;
  font-size: 12px;
  font-weight: 700;
}

h1 {
  margin: 2px 0 0;
  font-size: 26px;
}

.head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.panel {
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 13px 16px;
  border-bottom: 1px solid #ebeef5;
  color: #303133;
  font-weight: 700;
}

.panel-body {
  padding: 8px 16px 16px;
}

.group-title,
.panel-head,
.member-user,
.grant-form,
.settings-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.group-name-input {
  width: 220px;
}

.group-title {
  width: 100%;
}

.group-name {
  font-weight: 700;
  color: #303133;
}

.group-body {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(360px, 0.9fr);
  gap: 16px;
}

.member-panel,
.admin-panel {
  min-width: 0;
}

.panel-head {
  justify-content: space-between;
  margin-bottom: 10px;
  font-weight: 700;
}

.member-add {
  width: 260px;
}

.grant-form {
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.effect-select {
  width: 90px;
}

.resource-type {
  width: 100px;
}

.resource-picker {
  width: 220px;
}

.settings-row {
  align-items: stretch;
  max-width: 560px;
}

.muted {
  color: #909399;
}

@media (max-width: 900px) {
  .page-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .head-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .group-body {
    grid-template-columns: 1fr;
  }

  .member-add,
  .resource-picker,
  .group-name-input {
    width: 100%;
  }

  .panel-head,
  .settings-row {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
