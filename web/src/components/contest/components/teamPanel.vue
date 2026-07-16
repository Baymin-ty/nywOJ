<template>
  <div class="team-panel">
    <!-- 我的队伍卡片（选手侧） -->
    <el-card v-if="!canManage" shadow="never" class="team-card">
      <template #header>
        <span class="team-card-title">我的队伍</span>
      </template>
      <template v-if="myTeam">
        <div class="team-row">
          <span class="team-name">{{ myTeam.name }}</span>
          <el-tag v-if="myTeam.isCaptain" size="small" type="warning">队长</el-tag>
        </div>
        <div class="team-members">
          <el-tag v-for="m in myTeam.members" :key="m.uid" class="team-member" effect="plain">
            {{ m.name }}<template v-if="m.isCaptain">（队长）</template>
          </el-tag>
          <span class="team-hint">{{ myTeam.members.length }}/{{ maxSize }} 人</span>
        </div>
        <div class="team-row" v-if="myTeam.isCaptain">
          <span class="team-hint">邀请码：</span>
          <el-tag type="info" class="invite-code">{{ myTeam.inviteCode }}</el-tag>
          <span class="team-hint">发给队友，队友在本页输入即可入队</span>
        </div>
        <el-popconfirm v-if="allowSelfForm" title="确认退出队伍？（最后一人退出将解散队伍）" confirm-button-text="确认" cancel-button-text="取消"
          @confirm="leaveTeam">
          <template #reference>
            <el-button type="danger" plain size="small" style="margin-top: 10px;">退出队伍</el-button>
          </template>
        </el-popconfirm>
        <el-alert v-else type="info" :closable="false" title="本场比赛由管理员统一编队。" style="margin-top: 10px;" />
      </template>
      <template v-else-if="allowSelfForm">
        <el-form inline>
          <el-form-item label="创建队伍">
            <el-input v-model="newTeamName" placeholder="队名（1-40 字符）" style="width: 220px;" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="createTeam">建队</el-button>
          </el-form-item>
        </el-form>
        <el-divider style="margin: 8px 0;" />
        <el-form inline>
          <el-form-item label="加入队伍">
            <el-input v-model="joinCode" placeholder="邀请码" style="width: 220px;" />
          </el-form-item>
          <el-form-item>
            <el-button type="success" @click="joinTeam">加入</el-button>
          </el-form-item>
        </el-form>
      </template>
      <el-alert v-else type="info" :closable="false" title="本场比赛由管理员统一建队，请联系管理员。" />
    </el-card>

    <!-- 队伍管理（管理员侧） -->
    <el-card v-if="canManage" shadow="never" class="team-card">
      <template #header>
        <span class="team-card-title">队伍管理</span>
      </template>
      <el-form inline>
        <el-form-item label="队名">
          <el-input v-model="adminTeamName" placeholder="队名" style="width: 180px;" />
        </el-form-item>
        <el-form-item label="成员">
          <el-select v-model="adminMemberUids" multiple filterable remote reserve-keyword
            :remote-method="searchUsers" :loading="userSearchLoading" placeholder="搜索用户名或 uid（首位为队长）"
            style="width: 360px;">
            <el-option v-for="u in userOptions" :key="u.uid" :label="userOptionLabel(u)" :value="u.uid" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="adminCreate">建队</el-button>
        </el-form-item>
      </el-form>
      <el-table :data="teamList" v-loading="loading" empty-text="暂无队伍">
        <el-table-column prop="teamId" label="#" width="70" />
        <el-table-column prop="name" label="队名" min-width="150" />
        <el-table-column label="成员" min-width="240">
          <template #default="scope">
            <el-tag v-for="m in scope.row.members" :key="m.uid" class="team-member" effect="plain" size="small">
              {{ m.name }}<template v-if="m.isCaptain">（队长）</template>
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="inviteCode" label="邀请码" width="110" />
        <el-table-column prop="createTime" label="创建时间" min-width="150" />
        <el-table-column label="操作" width="150">
          <template #default="scope">
            <el-button size="small" plain @click="openEdit(scope.row)">编辑</el-button>
            <el-popconfirm title="确认移除该队伍及全部成员？" confirm-button-text="确认" cancel-button-text="取消"
              @confirm="adminRemove(scope.row.teamId)">
              <template #reference>
                <el-button size="small" type="danger" plain>移除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-dialog v-model="editVisible" title="编辑队伍" width="min(520px, 92vw)">
      <el-form label-width="70px">
        <el-form-item label="队名">
          <el-input v-model="editTeamName" placeholder="队名" />
        </el-form-item>
        <el-form-item label="成员">
          <el-select v-model="editMemberUids" multiple filterable remote reserve-keyword
            :remote-method="searchUsers" :loading="userSearchLoading" placeholder="搜索用户名或 uid（首位为队长）"
            style="width: 100%;">
            <el-option v-for="u in userOptions" :key="u.uid" :label="userOptionLabel(u)" :value="u.uid" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" @click="adminUpdate">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import axios from 'axios';

export default {
  name: 'teamPanel',
  props: {
    canManage: { type: Boolean, default: false },
  },
  emits: ['changed'],
  data() {
    return {
      cid: 0,
      myTeam: null,
      maxSize: 3,
      allowSelfForm: true,
      newTeamName: '',
      joinCode: '',
      teamList: [],
      adminTeamName: '',
      adminMemberUids: [],
      editVisible: false,
      editTeamId: null,
      editTeamName: '',
      editMemberUids: [],
      userOptions: [],
      userSearchLoading: false,
      loading: false,
    };
  },
  methods: {
    all() {
      if (this.canManage) this.loadTeamList();
      else this.loadMyTeam();
    },
    loadMyTeam() {
      axios.post('/api/contest/getMyTeam', { cid: this.cid }).then(res => {
        this.myTeam = res.data.team;
        this.maxSize = res.data.maxSize;
        this.allowSelfForm = res.data.allowSelfForm;
      }).catch(() => { });
    },
    loadTeamList() {
      this.loading = true;
      axios.post('/api/contest/getTeamList', { cid: this.cid }).then(res => {
        this.teamList = res.data.data || [];
        this.mergeUserOptions(this.teamList.flatMap(t => t.members || []));
      }).catch(() => { }).finally(() => { this.loading = false; });
    },
    createTeam() {
      axios.post('/api/contest/createTeam', { cid: this.cid, name: this.newTeamName }).then(res => {
        const data = this.assertOk(res, '建队失败');
        if (!data.inviteCode) throw this.uiError('建队失败：服务器未返回邀请码');
        this.$message.success(`建队成功，邀请码 ${data.inviteCode}`);
        this.newTeamName = '';
        this.loadMyTeam();
        this.$emit('changed');
      }).catch(err => this.$message.error(this.apiError(err, '建队失败')));
    },
    joinTeam() {
      axios.post('/api/contest/joinTeam', { cid: this.cid, inviteCode: this.joinCode }).then(res => {
        const data = this.assertOk(res, '加入失败');
        this.$message.success(`已加入 ${data.name || '队伍'}`);
        this.joinCode = '';
        this.loadMyTeam();
        this.$emit('changed');
      }).catch(err => this.$message.error(this.apiError(err, '加入失败')));
    },
    leaveTeam() {
      axios.post('/api/contest/leaveTeam', { cid: this.cid }).then(res => {
        this.assertOk(res, '退队失败');
        this.$message.success('已退出队伍');
        this.myTeam = null;
        this.loadMyTeam();
        this.$emit('changed');
      }).catch(err => this.$message.error(this.apiError(err, '退队失败')));
    },
    adminCreate() {
      axios.post('/api/contest/adminCreateTeam', {
        cid: this.cid, name: this.adminTeamName, memberUids: this.adminMemberUids,
      }).then(res => {
        this.assertOk(res, '建队失败');
        this.$message.success('建队成功');
        this.adminTeamName = '';
        this.adminMemberUids = [];
        this.loadTeamList();
        this.$emit('changed');
      }).catch(err => this.$message.error(this.apiError(err, '建队失败')));
    },
    openEdit(team) {
      this.editTeamId = team.teamId;
      this.editTeamName = team.name;
      this.editMemberUids = (team.members || []).map(m => m.uid);
      this.mergeUserOptions(team.members || []);
      this.editVisible = true;
    },
    adminUpdate() {
      axios.post('/api/contest/adminUpdateTeam', {
        cid: this.cid, teamId: this.editTeamId, name: this.editTeamName, memberUids: this.editMemberUids,
      }).then(res => {
        this.assertOk(res, '保存失败');
        this.$message.success('已保存');
        this.editVisible = false;
        this.loadTeamList();
        this.$emit('changed');
      }).catch(err => this.$message.error(this.apiError(err, '保存失败')));
    },
    adminRemove(teamId) {
      axios.post('/api/contest/adminRemoveTeam', { cid: this.cid, teamId }).then(res => {
        this.assertOk(res, '移除失败');
        this.$message.success('已移除');
        this.loadTeamList();
        this.$emit('changed');
      }).catch(err => this.$message.error(this.apiError(err, '移除失败')));
    },
    assertOk(res, fallback) {
      if (res && res.status === 200) return res.data || {};
      const detail = this.responseDetail(res && res.data);
      throw this.uiError(detail ? `${fallback}：${detail}` : fallback);
    },
    uiError(message) {
      const err = new Error(message);
      err.userMessage = message;
      return err;
    },
    apiError(err, fallback) {
      if (err && err.userMessage) return err.userMessage;
      const detail = this.responseDetail(err && err.response && err.response.data) || (err && err.message);
      return detail ? `${fallback}：${detail}` : fallback;
    },
    responseDetail(data) {
      if (!data) return '';
      if (typeof data === 'string') return data;
      return data.message || data.error || '';
    },
    userOptionLabel(user) {
      return `${user.name} (#${user.uid})`;
    },
    mergeUserOptions(users) {
      const map = new Map(this.userOptions.map(u => [Number(u.uid), u]));
      for (const user of users || []) {
        if (user && user.uid != null) map.set(Number(user.uid), { uid: Number(user.uid), name: user.name });
      }
      this.userOptions = Array.from(map.values()).sort((a, b) => Number(a.uid) - Number(b.uid));
    },
    searchUsers(query) {
      const q = (query || '').trim();
      if (!q) return;
      this.userSearchLoading = true;
      axios.post('/api/auth/searchUsers', { q }).then(res => {
        this.mergeUserOptions((res.data && res.data.users) || []);
      }).catch(err => {
        this.$message.error(this.apiError(err, '搜索用户失败'));
      }).finally(() => { this.userSearchLoading = false; });
    },
  },
  mounted() {
    this.cid = this.$route.params.cid;
    this.all();
  },
};
</script>

<style scoped>
.team-card {
  margin-bottom: 14px;
}

.team-card-title {
  font-weight: 700;
}

.team-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.team-name {
  font-size: 17px;
  font-weight: 700;
}

.team-members {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.team-member {
  margin-right: 4px;
}

.team-hint {
  color: #909399;
  font-size: 12px;
}

.invite-code {
  font-family: 'Courier New', monospace;
  font-weight: 700;
  letter-spacing: 1px;
}

@media (max-width: 768px) {
  .team-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .team-row :deep(.el-input),
  .team-card :deep(.el-select) {
    width: 100% !important;
  }

  .team-card :deep(.el-form--inline .el-form-item) {
    display: flex;
    width: 100%;
    margin-right: 0;
  }

  .team-card :deep(.el-form--inline .el-form-item__content) {
    flex: 1;
    min-width: 0;
  }

  :deep(.el-dialog__body) {
    padding: 12px;
  }
}
</style>
