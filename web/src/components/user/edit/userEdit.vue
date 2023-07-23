<template>
  <div style="margin: auto;max-width: 1000px;min-width: 800px;">
    <el-tabs v-model="activeName" @tab-change="switchTab" tab-position="left">
      <el-tab-pane lazy name="profile">
        <template #label>
          <el-icon>
            <User />
          </el-icon>
          个人信息
        </template>
        <userProfile />
      </el-tab-pane>
      <el-tab-pane lazy name="security">
        <template #label>
          <el-icon>
            <Lock />
          </el-icon>
          账号安全
        </template>
        <userSecurity />
      </el-tab-pane>
      <el-tab-pane lazy name="session">
        <template #label>
          <el-icon>
            <Guide />
          </el-icon>
          会话管理
        </template>
        <userSession />
      </el-tab-pane>
      <el-tab-pane lazy name="audit">
        <template #label>
          <el-icon>
            <Setting />
          </el-icon>
          操作记录
        </template>
        <userAudit />
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
      activeName: ''
    }
  },
  methods: {
    switchTab(tab) {
      let url = location.pathname;
      if (tab !== 'main')
        url += ('?tab=' + tab);
      history.state.current = url;
      history.replaceState(history.state, null, url);
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