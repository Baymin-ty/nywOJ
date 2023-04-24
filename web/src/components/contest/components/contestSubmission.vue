<template>
  <el-table :data="submissionList" height="600px" :header-cell-style="{ textAlign: 'center' }" :cell-style="cellStyle">
    <el-table-column prop="sid" label="#" min-width="5%" />
    <el-table-column prop="title" label="题目" min-width="15%">
      <template #default="scope">
        <span class="rlink" @click="this.$router.push('/contest/' + cid + '/problem/' + scope.row.idx)"> {{
          scope.row.title
        }}</span>
      </template>
    </el-table-column>
    <el-table-column prop="name" label="提交者" min-width="12%">
      <template #default="scope">
        <span class="rlink" @click="this.$router.push('/user/' + scope.row.uid)">
          {{ scope.row.name }}
        </span>
      </template>
    </el-table-column>
    <el-table-column prop="judgeResult" label="评测状态" min-width="13%">
      <template #default="scope">
        <span style="cursor: pointer;"
          @click="this.$router.push({ path: '/submission/' + scope.row.sid, query: { isContest: true } })">
          {{ scope.row.judgeResult }}
        </span>
      </template>
    </el-table-column>
    <el-table-column prop="score" label="分数" min-width="6%">
      <template #default="scope">
        <span> {{ scope.row.score }}</span>
      </template>
    </el-table-column>
    <el-table-column prop="judgeResult" label="总用时" min-width="10%">
      <template #default="scope">
        <span> {{ scope.row.time }} ms</span>
      </template>
    </el-table-column>
    <el-table-column prop="judgeResult" label="内存" min-width="10%">
      <template #default="scope">
        <span> {{ scope.row.memory }} </span>
      </template>
    </el-table-column>
    <el-table-column prop="codeLength" label="代码长度" min-width="10%">
      <template #default="scope">
        <span> {{ scope.row.codeLength }} B </span>
      </template>
    </el-table-column>
    <el-table-column prop="submitTime" label="提交时间" min-width="19%" />
  </el-table>
</template>

<script>
import axios from "axios"
import { ElMessage } from 'element-plus'
import { resColor, scoreColor } from '@/assets/common'

export default {
  name: 'submissionList',
  data() {
    return {
      submissionList: [],
    }
  },
  methods: {
    all() {
      axios.post('/api/contest/getSubmissionList', {
        cid: this.cid
      }).then(res => {
        this.submissionList = res.data.data;
        this.total = res.data.total;
      }).catch(err => {
        ElMessage({
          message: '获取提交记录失败' + err.message,
          type: 'error',
          duration: 2000,
        });
      });
    },
    cellStyle({ row, columnIndex }) {
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
  },
  mounted() {
    this.cid = this.$route.params.cid;
    this.all();
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.box-card {
  height: 700px;
  margin: 10px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
}
</style>