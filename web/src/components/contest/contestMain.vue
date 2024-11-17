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
              <router-link class="rlink" :to="'/contest/player/' + contestInfo.cid">
                <el-icon id="picon" size="13">
                  <UserFilled />
                </el-icon>
                × {{ contestInfo.playerCnt }}
              </router-link>
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
              <v-md-preview :text="contestInfo.description" style="min-height: 600px;" />
            </el-tab-pane>
            <el-tab-pane name="problemList" v-if="joinAuth || viewAuth">
              <template #label>
                <el-icon style="margin: 4px;">
                  <Document />
                </el-icon>
                题目列表
              </template>
              <contestProblemList :ctype="contestInfo.type" ref="problemList" />
            </el-tab-pane>
            <el-tab-pane name="submission" v-if="joinAuth || viewAuth">
              <template #label>
                <el-icon style="margin: 4px;">
                  <DataAnalysis />
                </el-icon>
                提交记录
              </template>
              <contestSubmission ref="submission" />
            </el-tab-pane>
            <el-tab-pane name="rank" v-if="viewAuth">
              <template #label>
                <el-icon style="margin: 4px;">
                  <DataLine />
                </el-icon>
                排行榜
              </template>
              <contestRank ref="rank" />
            </el-tab-pane>
            <el-tab-pane name="manageC" v-if="this.gid >= 2">
              <template #label>
                <el-icon style="margin: 4px;">
                  <SetUp />
                </el-icon>
                比赛管理
              </template>
              <el-row>
                <el-col :xs="24" :sm="24" :md="15" style="margin-bottom: 20px;">
                  <v-md-editor height="580px"
                    left-toolbar="undo redo clear | h bold italic strikethrough quote | ul ol table hr | link image code"
                    style="padding-right: 100px;" v-model="tmpInfo.description"></v-md-editor>
                </el-col>
                <el-col :xs="24" :sm="24" :md="9" style="padding-left: 30px;">
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
                      <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认重测该场比赛所有提交?"
                        @confirm="reJudgeContest">
                        <template #reference>
                          <el-button type="warning" :disabled="tmpInfo.done">
                            重测比赛
                          </el-button>
                        </template>
                      </el-popconfirm>
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
            <el-tab-pane name="manageP" v-if="this.gid >= 2">
              <template #label>
                <el-icon style="margin: 4px;">
                  <SetUp />
                </el-icon>
                题目管理
              </template>
              <problemManage ref="manageP" />
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script>
import axios from 'axios';
import contestSubmission from './components/contestSubmission.vue'
import contestRank from './components/contestRank.vue'
import contestProblemList from './components/contestProblemList.vue'
import problemManage from './components/problemManage.vue'

export default {
  name: "contestMain",
  components: {
    contestSubmission,
    contestRank,
    contestProblemList,
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
      },
      needUpdate: ['problemList', 'submission', 'rank', 'manageP']
    }
  },
  methods: {
    updateContest() {
      axios.post('/api/contest/updateContestInfo', {
        cid: this.cid,
        info: this.tmpInfo
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('修改成功');
        } else {
          this.$message.error('修改失败' + res.data.message);
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
          this.$message.error(res.data.message);
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
      if (this.needUpdate.includes(tab)) {
        this.$nextTick(() => { this.$refs[tab].all(); });
      }
    },
    closeContest() {
      axios.post('/api/contest/closeContest', {
        cid: this.cid,
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('操作成功');
        } else {
          this.$message.error('操作失败' + res.data.message);
        }
        this.all();
      });
    },
    regContest() {
      axios.post('/api/contest/contestReg', {
        cid: this.cid,
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('报名成功');
        } else {
          this.$message.error('报名失败' + res.data.message);
        }
        this.all();
      });
    },
    reJudgeContest() {
      axios.post('/api/judge/reJudgeContest', {
        cid: this.cid,
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('重测成功');
          this.$router.push({
            path: '/contest/' + this.cid,
            query: {
              tab: 'submission'
            }
          });
        } else {
          this.$message.error('重测失败' + res.data.message);
        }
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

#picon {
  vertical-align: -2px;
}
</style>