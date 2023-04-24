<template>
  <div style="margin: auto; max-width: 1500px;">
    <el-row>
      <el-col :span="24">
        <el-card class="box-card" shadow="hover">
          <template #header>
            <div class="card-header">
              <p class="title">{{ contestInfo.title }}
                <el-button v-show="contestInfo.regAble" type="danger" plain @click="regContest">点击报名</el-button>
                <el-button v-show="contestInfo.isReg" type="info" disabled>已报名</el-button>
              </p>
            </div>
          </template>
          <el-descriptions :column="6" size="large">
            <el-descriptions-item label="开始时间">{{ contestInfo.start }}</el-descriptions-item>
            <el-descriptions-item label="结束时间">{{ contestInfo.end }}</el-descriptions-item>
            <el-descriptions-item label="比赛时长">{{ contestInfo.length }} min</el-descriptions-item>
            <el-descriptions-item label="比赛类型">{{ contestInfo.type }}</el-descriptions-item>
            <el-descriptions-item label="比赛状态">
              <el-tag style="margin-left: 10px;" :type="tagType[contestInfo.status]">
                {{ contestInfo.status }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="参赛人数">
              <span class="rlink" @click="this.$router.push('/contest/player/' + contestInfo.cid)">
                <el-icon size="13">
                  <UserFilled />
                </el-icon>
                × {{ contestInfo.playerCnt }}
              </span>
            </el-descriptions-item>
          </el-descriptions>
          <el-progress :text-inside="true" :stroke-width="16" :percentage="percentage" status="success"
            style="margin: 5px;" />
          <el-tabs v-model="activeName" class="demo-tabs" @tab-change="switchTab">
            <el-tab-pane name="main">
              <template #label>
                <el-icon style="margin: 4px;">
                  <Place />
                </el-icon>
                比赛介绍
              </template>
              <v-md-preview :text="contestInfo.description" />
            </el-tab-pane>
            <el-tab-pane name="problem" lazy v-if="joinAuth || viewAuth">
              <template #label>
                <el-icon style="margin: 4px;">
                  <Document />
                </el-icon>
                题目列表
              </template>
              <contestProblem />
            </el-tab-pane>
            <el-tab-pane name="submission" lazy v-if="viewAuth">
              <template #label>
                <el-icon style="margin: 4px;">
                  <DataAnalysis />
                </el-icon>
                提交记录
              </template>
              <contestSubmission />
            </el-tab-pane>
            <el-tab-pane name="rank" lazy v-if="viewAuth">
              <template #label>
                <el-icon style="margin: 4px;">
                  <DataLine />
                </el-icon>
                排行榜
              </template>
              <contestRank />
            </el-tab-pane>
            <el-tab-pane name="manageC" lazy v-if="this.gid >= 2">
              <template #label>
                <el-icon style="margin: 4px;">
                  <SetUp />
                </el-icon>
                比赛管理
              </template>
              <el-row>
                <el-col :span="15">
                  <v-md-editor height="600px" style="padding-right: 100px;" v-model="tmpInfo.description"></v-md-editor>
                </el-col>
                <el-col :span="9" style="padding-left: 30px;">
                  <el-form>
                    <el-form-item label="比赛标题">
                      <el-input v-model="tmpInfo.title" :disabled="tmpInfo.done" />
                    </el-form-item>
                    <el-form-item label="开始时间">
                      <div class="block">
                        <el-date-picker v-model="tmpInfo.start" type="datetime" :disabled="tmpInfo.done" />
                      </div>
                    </el-form-item>
                    <el-form-item label="比赛时长">
                      <el-slider v-model="tmpInfo.length" show-input :min="10" :max="600" :step="10"
                        :disabled="tmpInfo.done" />
                    </el-form-item>
                    <el-form-item label="比赛类型">
                      <el-select v-model="tmpInfo.type" class="m-2" :disabled="tmpInfo.done">
                        <el-option label="OI" value="OI" />
                        <el-option label="IOI" value="IOI" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="是否公开">
                      <el-switch v-model="tmpInfo.isPublic" size="large" active-text="公开" inactive-text="私有"
                        :disabled="tmpInfo.done" />
                    </el-form-item>
                    <el-form-item>
                      <el-button type="danger" @click="updateContest" :disabled="tmpInfo.done">更新比赛</el-button>
                      <el-button type="primary" :disabled="tmpInfo.done"
                        @click="this.tmpInfo = JSON.parse(JSON.stringify(this.contestInfo));">重新设置</el-button>
                      <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认结束比赛?(结束后无法再修改比赛)"
                        @confirm="closeContest">
                        <template #reference>
                          <el-button type="danger" :disabled="tmpInfo.done">
                            结束比赛
                          </el-button>
                        </template>
                      </el-popconfirm>
                    </el-form-item>
                  </el-form>
                </el-col>
              </el-row>
            </el-tab-pane>
            <el-tab-pane name="manageP" lazy v-if="this.gid >= 2">
              <template #label>
                <el-icon style="margin: 4px;">
                  <SetUp />
                </el-icon>
                题目管理
              </template>
              <problemManage />
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script>
import axios from 'axios';
import { ElMessage } from 'element-plus'
import contestSubmission from './components/contestSubmission.vue'
import contestRank from './components/contestRank.vue'
import contestProblem from './components/contestProblem.vue'
import problemManage from './components/problemManage.vue'

export default {
  name: "contestMain",
  components: {
    contestSubmission,
    contestRank,
    contestProblem,
    problemManage
  },
  data() {
    return {
      cid: 0,
      gid: 1,
      contestInfo: {},
      tmpInfo: {},
      activeName: '',
      percentage: 0,
      joinAuth: false,
      viewAuth: false,
      tagType: {
        '未开始': '',
        '正在进行': 'danger',
        '等待测评': 'success',
        '已结束': 'info',
      }
    }
  },
  methods: {
    updateContest() {
      axios.post('/api/contest/updateContestInfo', {
        cid: this.cid,
        info: this.tmpInfo
      }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '修改成功',
            type: 'success',
            duration: 1000,
          });
        } else {
          ElMessage({
            message: '修改失败' + res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
        this.all();
      });
    },
    frushPercentage() {
      this.percentage = parseInt((new Date().getTime() -
        new Date(this.contestInfo.start).getTime()) / 10 / 60 / this.contestInfo.length);
      if (this.percentage < 0) this.percentage = 0;
      else if (this.percentage > 100) this.percentage = 100;
    },
    all() {
      axios.post('/api/contest/getContestInfo', { cid: this.cid }).then(res => {
        if (res.status === 200) {
          this.contestInfo = res.data.data;
          this.contestInfo.isPublic = !!res.data.data.isPublic;
          this.contestInfo.done = !!res.data.data.done;
          this.joinAuth = res.data.data.auth.join;
          this.viewAuth = res.data.data.auth.view;
          this.tmpInfo = JSON.parse(JSON.stringify(this.contestInfo));
          this.frushPercentage();
          this.timer = setInterval(() => {
            this.frushPercentage();
          }, 60000);
          document.title = "比赛 — " + this.contestInfo.title;
        }
        else {
          ElMessage({
            message: res.data.message,
            type: 'error',
            duration: 2000,
          });
          this.contestInfo.description = "# 您的权限不足";
        }
      });
    },
    switchTab(tab) {
      let url = location.pathname;
      if (tab !== 'main')
        url += ('?tab=' + tab);
      history.state.current = url;
      history.replaceState(history.state, null, url);
    },
    closeContest() {
      axios.post('/api/contest/closeContest', {
        cid: this.cid,
      }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '操作成功',
            type: 'success',
            duration: 1000,
          });
        } else {
          ElMessage({
            message: '操作失败' + res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
        this.all();
      });
    },
    regContest() {
      axios.post('/api/contest/contestReg', {
        cid: this.cid,
      }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '报名成功',
            type: 'success',
            duration: 1000,
          });
        } else {
          ElMessage({
            message: '报名失败' + res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
        this.all();
      });
    }
  },
  mounted() {
    this.cid = this.$route.params.cid;
    this.activeName = this.$route.query.tab || 'main';
    this.gid = this.$store.state.gid;
    this.all();
  },
  beforeUnmount() {
    clearInterval(this.timer);
  }
}
</script>

<style scoped>
.box-card {
  margin: 10px;
  text-align: left;
}

.title {
  text-align: center;
  margin: 0;
  font-size: 25px;
}

.demo-tabs {
  margin: 10px;
}
</style>