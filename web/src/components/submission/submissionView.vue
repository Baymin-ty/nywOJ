<template>
  <el-row style="min-width: 600px;max-width: 1250px; margin: 0 auto;">
    <el-table :data="table" style="margin-bottom:10px;" :header-cell-style="{ textAlign: 'center' }"
      :cell-style="cellStyle2">
      <el-table-column prop="sid" label="#" min-width="5%" />
      <el-table-column prop="title" label="题目" min-width="15%">
        <template #default="scope">
          <router-link class="rlink" :to="!isContest ?
            '/problem/' + scope.row.pid :
            '/contest/' + scope.row.cid + '/problem/' + scope.row.idx">
            {{ scope.row.title }}
          </router-link>
          <el-icon id="hidden" v-if="!scope.row.isPublic && !isContest">
            <Hide />
          </el-icon>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="提交者" min-width="10%">
        <template #default="scope">
          <router-link class="rlink" :to="'/user/' + scope.row.uid">
            {{ scope.row.name }}
          </router-link>
        </template>
      </el-table-column>
      <el-table-column prop="judgeResult" label="评测状态" min-width="14%">
        <template #default="scope">
          <span>
            {{ scope.row.judgeResult }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="score" label="分数" min-width="5%">
        <template #default="scope">
          <span> {{ scope.row.score }}</span>
        </template>
      </el-table-column>
      <el-table-column label="总用时" min-width="8%">
        <template #default="scope">
          <span> {{ scope.row.time }} ms</span>
        </template>
      </el-table-column>
      <el-table-column label="内存" min-width="8%">
        <template #default="scope">
          <span> {{ scope.row.memory }} </span>
        </template>
      </el-table-column>
      <el-table-column prop="codeLength" label="语言 / 代码长度" min-width="12%">
        <template #default="scope">
          <span>{{ $store.state.langList[scope.row.lang].des }} / {{ scope.row.codeLength }} B </span>
        </template>
      </el-table-column>
      <el-table-column prop="submitTime" label="提交时间" min-width="13%" />
      <el-table-column prop="machine" label="评测机" min-width="10%" />
    </el-table>
  </el-row>
  <el-row style="text-align: center; margin: 0 auto; max-width: 1250px; min-width: 600px;">
    <el-col :span="24" style="min-width: 400px;margin: 0 auto;">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class=" card-header">
            代码
            <el-button-group>
              <el-popconfirm v-if="gid > 2" confirm-button-text="确认" cancel-button-text="取消" title="确认取消成绩?"
                @confirm="cancelSubmission">
                <template #reference>
                  <el-button type="warning">
                    <el-icon class="el-icon--left">
                      <CloseBold />
                    </el-icon>
                    取消成绩
                  </el-button>
                </template>
              </el-popconfirm>
              <el-popconfirm v-if="gid > 1" confirm-button-text="确认" cancel-button-text="取消" title="确认重新测评?"
                @confirm="reJudge">
                <template #reference>
                  <el-button type="danger">
                    <el-icon class="el-icon--left">
                      <Refresh />
                    </el-icon>
                    重新测评
                  </el-button>
                </template>
              </el-popconfirm>
            </el-button-group>
          </div>
        </template>
        <monacoEditor v-if="hasTaken" :value="code"  :language="$store.state.langList[submissionInfo.lang].lang" @update:value="code = $event" :readOnly="true" />
      </el-card>
    </el-col>
  </el-row>
  <el-row style="text-align: center; margin: 0 auto; max-width: 1250px; min-width: 600px;">
    <el-col :span="24" style="min-width: 400px">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            测试点详情
          </div>
        </template>
        <el-table
          v-if="submissionInfo.judgeResult !== 'Compilation Error' && submissionInfo.judgeResult !== 'System Error' && !submissionInfo.done"
          :data="submissionInfo.singleCaseResult" height="auto" :row-class-name="tableRowClassName"
          :cell-style="cellStyle" :header-cell-style="{ textAlign: 'center' }">
          <el-table-column prop="caseId" label="#" min-width="10%" />
          <el-table-column prop="subtaskId" label="子任务" min-width="10%" />
          <el-table-column prop="judgeResult" label="结果" min-width="40%">
            <template #default="scope">
              <span> {{ scope.row.result }} </span>
            </template>
          </el-table-column>
          <el-table-column prop="time" label="用时" min-width="20%">
            <template #default="scope">
              <span> {{ Math.floor(scope.row.time) }} ms</span>
            </template>
          </el-table-column>
          <el-table-column prop="memory" label="内存" min-width="20%">
            <template #default="scope">
              <span> {{ scope.row.memory }} </span>
            </template>
          </el-table-column>
        </el-table>
        <caseDisplay
          v-if="submissionInfo.judgeResult !== 'Compilation Error' && submissionInfo.judgeResult !== 'System Error' && submissionInfo.subtaskInfo"
          :subtaskInfo="submissionInfo.subtaskInfo" />
        <v-md-preview
          v-show="submissionInfo.judgeResult === 'Compilation Error' || submissionInfo.judgeResult === 'System Error'"
          :text="submissionInfo.compileResult" />
      </el-card>
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios';
import { resColor, scoreColor } from '@/assets/common'
import monacoEditor from '@/components/monacoEditor.vue'
import caseDisplay from './caseDisplay.vue'

export default {
  name: "problemView",
  data() {
    return {
      gid: 1,
      table: [],
      submissionInfo: [],
      code: '',
      hasTaken: false,
      isContest: false,
      detailInfo: '',
      mounted: false,
      monacoOptions: {
        value: '',
        readOnly: true,
        language: "cpp",
      },
    }
  },
  components: {
    monacoEditor,
    caseDisplay
  },
  methods: {
    tableRowClassName(obj) {
      return (obj.row.result == 'Accepted' ? 'success' : '');
    },
    cellStyle({ row, columnIndex }) {
      let style = {};
      style['textAlign'] = 'center';
      if (columnIndex === 2) {
        style['font-weight'] = 500;
        style['color'] = resColor[row.result];
      }
      return style;
    },
    cellStyle2({ row, columnIndex }) {
      let style = {};
      style['textAlign'] = 'center';
      if (columnIndex === 3) {
        style['font-weight'] = 500;
        style['color'] = resColor[row.judgeResult];
      }
      if (columnIndex === 4) {
        style['font-weight'] = 500;
        style['color'] = scoreColor[Math.floor(row.score / 10)];
      }
      return style;
    },
    async reJudge() {
      await axios.post('/api/judge/reJudge', { sid: this.sid });
      this.all();
    },
    async all() {
      await axios.post(this.isContest ? '/api/contest/getSubmissionInfo' : '/api/judge/getSubmissionInfo', { sid: this.sid }).then(res => {
        if (res.status === 200) {
          this.submissionInfo = res.data.data;
          this.code = this.submissionInfo.code;
          this.hasTaken = true;
          this.submissionInfo.compileResult = "```\n" + this.submissionInfo.compileResult + "\n```";
          this.table[0] = this.submissionInfo;
          if (!this.submissionInfo.unShown && this.mounted && (this.submissionInfo.judgeResult === 'Waiting' ||
            this.submissionInfo.judgeResult === 'Pending' ||
            this.submissionInfo.judgeResult === 'Rejudging')) {
            setTimeout(() => {
              this.all();
            }, 1000)
          }
        }
      });
    },
    cancelSubmission() {
      axios.post('/api/judge/cancelSubmission', { sid: this.sid }).then(res => {
        if (res.status === 200) {
          this.$message.success('取消成功');
          this.all();
        } else {
          this.$message.error('取消失败');
        }
      });
    }
  },
  async mounted() {
    this.mounted = true;
    this.sid = this.$route.params.sid;
    if (this.$route.query.isContest) this.isContest = true;
    document.title = "提交记录";
    this.gid = this.$store.state.gid;
    await this.all();
  },
  unmounted() {
    this.mounted = false;
  }
}
</script>

<style scoped>
.box-card {
  margin: 10px;
  text-align: left;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
}

.sub {
  padding: 15px;
  border-style: solid;
  border-radius: 5px;
}
</style>