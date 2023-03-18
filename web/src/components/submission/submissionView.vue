<template>
  <el-row style="width: 1180px; margin: 0 auto;">
    <el-table :data="table" style="margin-bottom:10px;height:80px;" :header-cell-style="{ textAlign: 'center' }"
      :cell-style="cellStyle2">
      <el-table-column prop="sid" label="#" width="80px" />
      <el-table-column prop="title" label="题目" width="180px">
        <template #default="scope">
          <span style="cursor: pointer;" @click="this.$router.push('/problem/' + scope.row.pid)"> {{ scope.row.title
          }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="提交者" width="120px">
        <template #default="scope">
          <span style="cursor: pointer;" @click="this.$router.push('/user/' + scope.row.uid)">
            {{ scope.row.name }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="judgeResult" label="评测状态" width="180px">
        <template #default="scope">
          <span>
            {{ scope.row.judgeResult }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="score" label="分数" width="80px">
        <template #default="scope">
          <span> {{ scope.row.score }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="judgeResult" label="总用时" width="auto">
        <template #default="scope">
          <span> {{ scope.row.time }} ms</span>
        </template>
      </el-table-column>
      <el-table-column prop="judgeResult" label="内存" width="auto">
        <template #default="scope">
          <span> {{ scope.row.memory }} </span>
        </template>
      </el-table-column>
      <el-table-column prop="codeLength" label="代码长度" width="100px">
        <template #default="scope">
          <span> {{ scope.row.codeLength }} B </span>
        </template>
      </el-table-column>
      <el-table-column prop="submitTime" label="提交时间" width="180px" />
    </el-table>
  </el-row>
  <el-row style="text-align: center; margin: 0 auto; width: 1200px">
    <el-col :span="12" style="min-width: 400px">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            测试点详情
            <el-button type="primary" @click="all">
              刷新
            </el-button>
          </div>
        </template>
        <el-table v-show="submissionInfo.judgeResult !== 'Compilation Error'" :data="submissionInfo.caseResult"
          height="auto" :row-class-name="tableRowClassName" :cell-style="cellStyle"
          :header-cell-style="{ textAlign: 'center' }">
          <el-table-column label="#" type="index" width="80px" />
          <el-table-column prop="judgeResult" label="结果" width="auto">
            <template #default="scope">
              <span @click="showDetail(scope.row)" style="cursor: pointer;"> {{ scope.row.judgeResult }} </span>
            </template>
          </el-table-column>
          <el-table-column prop="time" label="用时" width="100">
            <template #default="scope">
              <span> {{ Math.floor(scope.row.time) }} ms</span>
            </template>
          </el-table-column>
          <el-table-column prop="memory" label="内存" width="100">
            <template #default="scope">
              <span> {{ scope.row.memory }} </span>
            </template>
          </el-table-column>
        </el-table>
        <v-md-preview v-show="submissionInfo.judgeResult === 'Compilation Error'" :text="submissionInfo.compileResult" />
      </el-card>
    </el-col>
    <el-col :span="12" style="min-width: 400px;margin: 0 auto;">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class=" card-header">
            代码
            <el-button v-show="gid > 1" type="danger" @click="reJudge">
              重新测评
            </el-button>
          </div>
        </template>
        <v-md-preview :text="submissionInfo.code"> </v-md-preview>
      </el-card>
    </el-col>
  </el-row>
  <el-dialog v-model="dialogVisible" title="测试点详情" style="width:1000px;border-radius: 10px; " class="pd">
    <el-divider />
    <v-md-preview :text="detailInfo"> </v-md-preview>
  </el-dialog>
</template>

<script>
import axios from 'axios';
import store from '@/sto/store';
import { resColor, scoreColor } from '@/assets/common'

export default {
  name: "problemView",
  data() {
    return {
      gid: 1,
      table: [],
      submissionInfo: [],
      code: '',
      dialogVisible: false,
      detailInfo: '',
    }
  },
  methods: {
    tableRowClassName(obj) {
      return (obj.row.judgeResult == 'Accepted' ? 'success' : '');
    },
    cellStyle({ row, columnIndex }) {
      let style = {};
      style['textAlign'] = 'center';
      if (columnIndex === 1) {
        style['font-weight'] = 500;
        style['color'] = resColor[row.judgeResult];
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
    showDetail(row) {
      this.detailInfo = '### Summary\n'

      this.detailInfo += '- result: `' + row.judgeResult + '`\n'
      this.detailInfo += '- time: `' + Math.floor(row.time) + ' ms`\n'
      this.detailInfo += '- memory: `' + row.memory + '`\n'

      this.detailInfo += '### Input\n';
      this.detailInfo += '```\n';
      this.detailInfo += row.input;

      if (row.input && row.input[row.input.length - 1] !== '\n')
        this.detailInfo += '\n';

      this.detailInfo += '```\n';

      this.detailInfo += '### Output\n';
      this.detailInfo += '```\n';
      this.detailInfo += row.output;

      if (row.output && row.output[row.output.length - 1] !== '\n')
        this.detailInfo += '\n';

      this.detailInfo += '```\n';

      this.detailInfo += '### Checker\n';
      this.detailInfo += '```\n';
      this.detailInfo += row.compareResult;
      this.detailInfo += '```\n';

      this.dialogVisible = true;
    },
    async reJudge() {
      await axios.post('/api/judge/reJudge', { sid: this.sid });
      this.all();
    },
    async all() {
      await axios.post('/api/judge/getSubmissionInfo', { sid: this.sid }).then(res => {
        if (res.status === 200) {
          this.submissionInfo = res.data.data
          this.submissionInfo.code = "```c++\n" + this.submissionInfo.code + "\n```";
          this.submissionInfo.compileResult = "```\n" + this.submissionInfo.compileResult + "```";
          this.table[0] = this.submissionInfo;
          this.listH = Math.max(210, this.submissionInfo.caseResult.length * 42);
        } else {
          this.$router.go(-1);
        }
      });
    }
  },
  async mounted() {
    this.sid = this.$route.params.sid;
    document.title = "提交记录";
    this.gid = store.state.gid;
    await this.all();
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
</style>