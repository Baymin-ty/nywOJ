<template>
  <div class="header">
    <div class="left-controls">
      <el-switch v-model="lastOnly" active-text="Last" inactive-text="All" @change="all" />
      <el-checkbox v-model="selfOnly" label="只看自己" @change="all" />
    </div>
    <el-pagination v-if="!(lastOnly && selfOnly)" @current-change="handleCurrentChange" :current-page="currentPage"
      :page-size="20" layout="total, prev, pager, next" :total="total"></el-pagination>
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
    <el-table-column prop="title" label="题目" min-width="18%">
      <template #default="scope">
        <router-link class="rlink" :to="'/contest/' + cid + '/problem/' + scope.row.idx">
          {{ scope.row.title }}
        </router-link>
      </template>
    </el-table-column>
    <el-table-column prop="name" label="提交者" min-width="12%">
      <template #default="scope">
        <router-link class="rlink" :to="'/user/' + scope.row.uid">
          {{ scope.row.name }}
        </router-link>
      </template>
    </el-table-column>
    <el-table-column prop="judgeResult" label="评测状态" min-width="12%">
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
    <el-table-column prop="judgeResult" label="总用时" min-width="6%">
      <template #default="scope">
        <span> {{ scope.row.time }} ms</span>
      </template>
    </el-table-column>
    <el-table-column prop="judgeResult" label="内存" min-width="6%">
      <template #default="scope">
        <span> {{ scope.row.memory }} </span>
      </template>
    </el-table-column>
    <el-table-column prop="codeLength" label="代码长度" min-width="6%">
      <template #default="scope">
        <span> {{ scope.row.codeLength }} B </span>
      </template>
    </el-table-column>
    <el-table-column prop="submitTime" label="提交时间" min-width="12%" />
    <el-table-column prop="machine" label="评测机" min-width="10%" />
  </el-table>
</template>

<script>
import axios from "axios"
import { resColor, scoreColor } from '@/assets/common'
import store from '@/sto/store'

export default {
  name: 'submissionList',
  data() {
    return {
      submissionList: [],
      currentPage: 1,
      total: 0,
      lastOnly: false,
      finished: false,
      cid: 0,
      selfOnly: false
    }
  },
  methods: {
    all() {
      this.finished = false;
      let url = '';
      if (this.lastOnly) url =
        this.selfOnly ? '/api/contest/getSingleUserLastSubmission' :
          '/api/contest/getLastSubmissionList';
      else url = '/api/contest/getSubmissionList'
      axios.post(url, {
        cid: this.cid,
        pageId: this.currentPage,
        uid: this.selfOnly ? this.uid : null
      }).then(res => {
        this.submissionList = res.data.data;
        this.total = res.data.total;
        this.finished = true;
      }).catch(err => {
        this.$message.error('获取提交记录失败' + err.message);
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

.left-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>