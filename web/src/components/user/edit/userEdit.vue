<template>
  <div style="margin: auto;max-width: 1000px;min-width: 800px;">
    <el-tabs v-model="activeName" @tab-change="switchTab" tab-position="left">
      <el-tab-pane name="profile">
        <template #label>
          <el-icon>
            <User />
          </el-icon>
          个人信息
        </template>
        <userProfile ref="profile" />
      </el-tab-pane>
      <el-tab-pane name="security">
        <template #label>
          <el-icon>
            <Lock />
          </el-icon>
          账号安全
        </template>
        <userSecurity />
      </el-tab-pane>
      <el-tab-pane name="session">
        <template #label>
          <el-icon>
            <Guide />
          </el-icon>
          会话管理
        </template>
        <userSession ref="session" />
      </el-tab-pane>
      <el-tab-pane name="audit">
        <template #label>
          <el-icon>
            <Setting />
          </el-icon>
          操作记录
        </template>
        <userAudit ref="audit" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script>
import userProfile from './userProfile.vue'
import userSecurity from './userSecurity.vue'
import userAudit from './userAudit.vue'
import userSession from './userSession.vue'

export default {
  name: "userEdit",
  components: {
    userProfile,
    userSecurity,
    userAudit,
    userSession
  },
  data() {
    return {
      activeName: '',
      needUpdate: ['profile', 'session', 'audit']
    }
  },
  methods: {
    switchTab(tab) {
      let url = location.pathname;
      if (tab !== 'main')
        url += ('?tab=' + tab);
      history.state.current = url;
      history.replaceState(history.state, null, url);
      if (this.needUpdate.includes(tab)) {
        this.$nextTick(() => { this.$refs[tab].all(); });
      }
    },
  },
  mounted() {
    this.activeName = this.$route.query.tab || 'profile';
  }
}
</script>

<style scoped>
.el-icon {
  vertical-align: middle;
}
</style>