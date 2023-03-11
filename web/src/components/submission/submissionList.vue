<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1200px">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          评测列表
          <el-pagination @current-change="handleCurrentChange" :current-page="currentPage" :page-size="20"
            layout="total, prev, pager, next" :total="total"></el-pagination>
          <el-button-group>
            <el-button type="primary" @click="all">刷新</el-button>
          </el-button-group>
        </div>
      </template>
      <el-table :data="submissionList" height="600px" :header-cell-style="{ textAlign: 'center' }"
        :cell-style="cellStyle">
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
            <span style="cursor: pointer;" @click="this.$router.push('/submission/' + scope.row.sid)">
              {{ scope.row.judgeResult }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="score" label="分数" width="60px">
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
    </el-card>
  </div>
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
      total: 0,
      currentPage: 1,
    }
  },
  methods: {
    all() {
      axios.post('/api/judge/getSubmissionList', {
        pageId: this.currentPage
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
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
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
  async mounted() {
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