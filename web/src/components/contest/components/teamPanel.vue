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
        <el-popconfirm title="确认退出队伍？（最后一人退出将解散队伍）" confirm-button-text="确认" cancel-button-text="取消"
          @confirm="leaveTeam">
          <template #reference>
            <el-button type="danger" plain size="small" style="margin-top: 10px;">退出队伍</el-button>
          </template>
        </el-popconfirm>
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
          <el-input v-model="adminMembers" placeholder="用户名，逗号分隔（首位为队长）" style="width: 280px;" />
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
        <el-table-column label="操作" width="100">
          <template #default="scope">
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
      adminMembers: '',
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
      }).catch(() => { }).finally(() => { this.loading = false; });
    },
    createTeam() {
      axios.post('/api/contest/createTeam', { cid: this.cid, name: this.newTeamName }).then(res => {
        this.$message.success(`建队成功，邀请码 ${res.data.inviteCode}`);
        this.newTeamName = '';
        this.loadMyTeam();
        this.$emit('changed');
      }).catch(err => this.$message.error(this.apiError(err, '建队失败')));
    },
    joinTeam() {
      axios.post('/api/contest/joinTeam', { cid: this.cid, inviteCode: this.joinCode }).then(res => {
        this.$message.success(`已加入 ${res.data.name}`);
        this.joinCode = '';
        this.loadMyTeam();
        this.$emit('changed');
      }).catch(err => this.$message.error(this.apiError(err, '加入失败')));
    },
    leaveTeam() {
      axios.post('/api/contest/leaveTeam', { cid: this.cid }).then(() => {
        this.$message.success('已退出队伍');
        this.myTeam = null;
        this.loadMyTeam();
        this.$emit('changed');
      }).catch(err => this.$message.error(this.apiError(err, '退队失败')));
    },
    adminCreate() {
      const members = this.adminMembers.split(/[，,]/).map(s => s.trim()).filter(Boolean);
      axios.post('/api/contest/adminCreateTeam', {
        cid: this.cid, name: this.adminTeamName, members,
      }).then(() => {
        this.$message.success('建队成功');
        this.adminTeamName = '';
        this.adminMembers = '';
        this.loadTeamList();
      }).catch(err => this.$message.error(this.apiError(err, '建队失败')));
    },
    adminRemove(teamId) {
      axios.post('/api/contest/adminRemoveTeam', { cid: this.cid, teamId }).then(() => {
        this.$message.success('已移除');
        this.loadTeamList();
      }).catch(err => this.$message.error(this.apiError(err, '移除失败')));
    },
    apiError(err, fallback) {
      const detail = err && err.response && err.response.data && err.response.data.message;
      return detail ? `${fallback}：${detail}` : fallback;
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
</style>
