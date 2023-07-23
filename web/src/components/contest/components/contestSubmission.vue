<template>
  <div class="header">
    <el-switch v-model="lastOnly" class="mb-2" active-text="最后一次提交" inactive-text="所有提交" @change="all" />
    <el-pagination @current-change="handleCurrentChange" :current-page="currentPage" :page-size="20"
      layout="total, prev, pager, next" :total="total"></el-pagination>
    <el-button type="primary" @click="all">
      <el-icon class="el-icon--left">
        <Refresh />
      </el-icon>
      刷新
    </el-button>
  </div>
  <el-table :data="submissionList" height="560px" :header-cell-style="{ textAlign: 'center' }" :cell-style="cellStyle"
    :row-class-name="tableRowClassName" v-loading="!finished">
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
import store from '@/sto/store'

export default {
  name: 'submissionList',
  data() {
    return {
      submissionList: [],
      currentPage: 1,
      total: 10,
      lastOnly: false,
      finished: false
    }
  },
  methods: {
    all() {
      this.finished = false;
      axios.post(this.lastOnly ? '/api/contest/getLastSubmissionList' : '/api/contest/getSubmissionList', {
        cid: this.cid,
        pageId: this.currentPage
      }).then(res => {
        this.submissionList = res.data.data;
        this.total = res.data.total;
        this.finished = true;
      }).catch(err => {
        ElMessage({
          message: '获取提交记录失败' + err.message,
          type: 'error',
          duration: 2000,
        });
      });
    },
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
    },
    tableRowClassName(obj) {
      return (obj.row.uid === this.uid ? 'success' : '');
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
    this.uid = store.state.uid;
    this.cid = this.$route.params.cid;
    this.all();
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 40px;
}
</style>