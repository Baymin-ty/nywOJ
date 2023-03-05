<template>
  <el-row style="width: 1180px; margin: 0 auto;">
    <el-table :data="table" style="margin-bottom:10px;height:80px;" :header-cell-style="{ textAlign: 'center' }"
      :cell-style="{ textAlign: 'center' }">
      <el-table-column prop="sid" label="#" width="100px" />
      <el-table-column prop="title" label="题目" width="200px">
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
      <el-table-column prop="judgeResult" label="评测状态" width="150px">
        <template #default="scope">
          <span style="cursor: pointer;" @click="this.$router.push('/submission/' + scope.row.sid)">
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
          <span> {{ scope.row.memory }} KB </span>
        </template>
      </el-table-column>
      <el-table-column prop="codeLength" label="代码长度" width="100px">
        <template #default="scope">
          <span> {{ scope.row.codeLength }} B </span>
        </template>
      </el-table-column>
      <el-table-column prop="submitTime" label="提交时间" width="200px" />
    </el-table>
  </el-row>
  <el-row style="width: 1200px; margin: 0 auto;">
    <el-col :span="10" style="min-width: 400px">
      <el-card class="box-card" shadow="hover" style="text-align: center;">
        <template #header>
          <div class="card-header">
            测试点详情（别等啦，评测机没写呢）
          </div>
        </template>
        <el-table v-loading="!finished" :data="info" border height="600px" :row-class-name="tableRowClassName"
          :cell-style="cellStyle" :header-cell-style="{ textAlign: 'center' }">
        </el-table>
      </el-card>
    </el-col>
    <el-col :span="14" style="min-width: 400px">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class=" card-header">
            代码
          </div>
        </template>
        <v-md-preview :text="submissionInfo.code"> </v-md-preview>
      </el-card>
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios';
import store from '@/sto/store';

export default {
  name: "problemView",
  data() {
    return {
      gid: 1,
      table: [],
      submissionInfo: [],
      code: '',
    }
  },
  async mounted() {
    this.sid = this.$route.params.sid;
    document.title = "提交记录 — " + this.sid;
    this.gid = store.state.gid;
    await axios.post('/api/judge/getSubmissionInfo', { sid: this.sid }).then(res => {
      this.submissionInfo = res.data.data
      this.table.push(this.submissionInfo);
    });
    this.submissionInfo.code = "```c++\n" + this.submissionInfo.code + "\n```";
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
  font-size: 30px;
}
</style>