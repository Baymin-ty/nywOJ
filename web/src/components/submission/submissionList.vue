<template>
  <el-row style="text-align: center; margin: 0 auto; max-width: 1500px; min-width: 600px;">
    <el-col :span="19">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            评测列表
            <el-pagination @current-change="handleCurrentChange" :current-page="currentPage" :page-size="20"
              layout="total, prev, pager, next" :total="total"></el-pagination>
            <el-button-group>
              <el-button type="success" @click="mySub">我的提交</el-button>
              <el-button type="primary" @click="all">刷新</el-button>
            </el-button-group>
          </div>
        </template>
        <el-table :data="submissionList" height="600px" :header-cell-style="{ textAlign: 'center' }"
          :cell-style="cellStyle">
          <el-table-column prop="sid" label="#" width="80px" />
          <el-table-column prop="title" label="题目" width="160px">
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
          <el-table-column prop="score" label="分数" width="auto">
            <template #default="scope">
              <span> {{ scope.row.score }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="judgeResult" label="总用时" width="100px">
            <template #default="scope">
              <span> {{ scope.row.time }} ms</span>
            </template>
          </el-table-column>
          <el-table-column prop="judgeResult" label="内存" width="100px">
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
    </el-col>
    <el-col :span="5" style="min-width: 250px;">
      <el-card class="box-card" shadow="hover" style="height: 300px;">
        <template #header>
          <div class="card-header">
            筛选记录
          </div>
        </template>
        <el-form :model="filter">
          <el-form-item>
            <el-input v-model="filter.pid" type="text" placeholder="题目编号" />
          </el-form-item>
          <el-form-item>
            <el-input v-model="filter.name" type="text" placeholder="用户名" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.res" placeholder="评测结果" style="width: 300px;">
              <el-option v-for="item in options" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
        </el-form>
        <el-divider />
        <el-button type="primary" @click="this.all">筛选记录</el-button>
        <el-button type="success" @click="clear">显示全部</el-button>
      </el-card>
    </el-col>
  </el-row>
</template>

<script>
import axios from "axios"
import { ElMessage } from 'element-plus'
import { resColor, scoreColor } from '@/assets/common'
import store from "@/sto/store"

export default {
  name: 'submissionList',
  data() {
    return {
      submissionList: [],
      total: 0,
      currentPage: 1,
      filter: {
        pid: null,
        name: null,
        res: null
      },
      options: [{
        value: -1,
        label: '不限结果',
      }, {
        value: 4,
        label: 'Accepted',
      }, {
        value: 5,
        label: 'Wrong Answer',
      }, {
        value: 6,
        label: 'Time Limit Exceeded',
      }, {
        value: 7,
        label: 'Memory Limit Exceeded',
      }, {
        value: 8,
        label: 'Runtime Error',
      }, {
        value: 9,
        label: 'Segmentation Fault',
      }, {
        value: 3,
        label: 'Compilation Error',
      }, {
        value: 10,
        label: 'Output Limit Exceeded',
      }, {
        value: 0,
        label: 'Waiting',
      }, {
        value: 1,
        label: 'Pending',
      }, {
        value: 2,
        label: 'Rejudging',
      }, {
        value: 11,
        label: 'Dangerous System Call',
      }, {
        value: 12,
        label: 'System Error',
      }],
    }
  },
  methods: {
    all() {
      axios.post('/api/judge/getSubmissionList', {
        pageId: this.currentPage,
        pid: this.filter.pid,
        name: this.filter.name,
        judgeRes: (this.filter.res === -1 ? null : this.filter.res)
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
    clear() {
      this.filter.name = this.filter.pid = this.filter.res = null;
      this.all();
    },
    mySub() {
      this.filter.name = store.state.name;
      this.all();
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