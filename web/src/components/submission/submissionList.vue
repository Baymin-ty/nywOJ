<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1400px">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          评测列表
          <el-pagination @current-change="handleCurrentChange" :current-page="currentPage" :page-size="20"
            layout="total, prev, pager, next" :total="total"></el-pagination>
          <el-button-group>
            <el-button type="success" @click="mySub">
              <el-icon class="el-icon--left">
                <UserFilled />
              </el-icon>
              我的提交
            </el-button>
            <el-button type="primary" @click="all">
              <el-icon class="el-icon--left">
                <Refresh />
              </el-icon>
              刷新
            </el-button>
          </el-button-group>
        </div>
      </template>
      <div style="display: inline-flex;">
        <el-form :inline="true" :model="filter">
          <el-form-item>
            <el-input v-model="filter.pid" type="text" placeholder="题目编号" style="width: 100px;" @keyup.enter="all" />
          </el-form-item>
          <el-form-item>
            <el-input v-model="filter.name" type="text" placeholder="用户名" style="width: 150px;" @keyup.enter="all" />
          </el-form-item>
          <el-form-item>
            <el-input v-model="filter.score" type="text" placeholder="分数" style="width: 100px;" @keyup.enter="all" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.res" placeholder="评测结果" style="width: 200px;">
              <el-option v-for="item in options" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
        </el-form>
        <span v-if="this.$store.state.gid >= 2" style="font-size: 14px; font-weight: 600; margin:0 20px 0 10px;">
          比赛提交：
          <el-switch v-model="queryAll" class="mb-2" active-text="显示" inactive-text="隐藏" @change="all" />
        </span>
        <el-button-group>
          <el-button type="primary" @click="this.all">
            筛选记录
          </el-button>
          <el-button type="success" @click="clear">
            显示全部
          </el-button>
        </el-button-group>
      </div>
      <el-table :data="submissionList" height="600px" :header-cell-style="{ textAlign: 'center' }"
        :cell-style="cellStyle" :row-class-name="tableRowClassName" v-loading="!finished">
        <el-table-column prop="sid" label="#" width="100px" />
        <el-table-column prop="title" label="题目" min-width="200px">
          <template #default="scope">
            <router-link class="rlink" :to="'/problem/' + scope.row.pid">
              {{ scope.row.title }}
            </router-link>
            <el-icon id="hidden" v-if="!scope.row.isPublic">
              <Hide />
            </el-icon>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="提交者" width="150px">
          <template #default="scope">
            <router-link class="rlink" :to="'/user/' + scope.row.uid">
              {{ scope.row.name }}
            </router-link>
          </template>
        </el-table-column>
        <el-table-column prop="judgeResult" label="评测状态" width="160px">
          <template #default="scope">
            <span style="cursor: pointer;" @click="go2s(scope)">
              {{ scope.row.judgeResult }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="score" label="分数" width="80px">
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
        <el-table-column prop="codeLength" label="代码长度" width="80px">
          <template #default="scope">
            <span> {{ scope.row.codeLength }} B </span>
          </template>
        </el-table-column>
        <el-table-column prop="submitTime" label="提交时间" fixed="right" width="160px" />
        <el-table-column prop="machine" label="评测机" fixed="right" min-width="100px" />
      </el-table>
    </el-card>
  </div>
</template>

<script>
import axios from "axios"
import { ElMessage } from 'element-plus'
import { resColor, scoreColor } from '@/assets/common'
import qs from 'qs'

export default {
  name: 'submissionList',
  data() {
    return {
      submissionList: [],
      total: 0,
      finished: false,
      currentPage: 1,
      filter: {
        pid: null,
        name: null,
        res: null,
        score: null
      },
      queryAll: false,
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
      }, {
        value: 13,
        label: 'Canceled',
      }],
    }
  },
  methods: {
    all() {
      this.finished = false;
      let param = {}, url = location.pathname;
      if (this.filter.name) param.name = this.filter.name;
      if (this.filter.pid) param.pid = this.filter.pid;
      if (this.filter.score !== null) param.score = this.filter.score;
      if (this.filter.res !== null) param.res = this.filter.res;
      if (this.queryAll && this.$store.state.gid > 1) param.queryAll = true;
      if (this.currentPage > 1)
        param.pageId = this.currentPage;
      let nurl = qs.stringify(param);
      if (nurl) url += ('?' + nurl);
      history.state.current = url;
      history.replaceState(history.state, null, url);
      axios.post('/api/judge/getSubmissionList', {
        pageId: this.currentPage,
        pid: this.filter.pid,
        name: this.filter.name,
        score: this.filter.score,
        judgeRes: (this.filter.res === -1 ? null : this.filter.res),
        queryAll: this.queryAll
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
    clear() {
      this.filter.name = this.filter.pid = this.filter.res = this.filter.score = null;
      this.all();
    },
    mySub() {
      this.filter.name = this.$store.state.name;
      this.all();
    },
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
    },
    tableRowClassName(obj) {
      return (obj.row.cid ? 'warning' : '');
    },
    go2s(scope) {
      if (!scope.row.cid)
        this.$router.push('/submission/' + scope.row.sid);
      else
        this.$router.push({ path: '/submission/' + scope.row.sid, query: { isContest: true } })
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
    let query = this.$route.query;
    if (query.res) this.filter.res = parseInt(query.res);
    if (query.score) this.filter.score = parseInt(query.score);
    if (query.name) this.filter.name = query.name;
    if (query.pid) this.filter.pid = query.pid;
    if (query.queryAll && this.$store.state.gid > 1) this.queryAll = true;
    if (query.pageId) this.currentPage = parseInt(query.pageId);
    this.all();
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.box-card {
  height: 750px;
  margin: 10px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
}

.el-form--inline .el-form-item {
  margin-right: 15px;
}
</style>