<template>
  <div class="page-wrap page-wrap--md">
    <el-card shadow="hover">
      <template #header>
        <div class="card-header card-header--wrap">
          <span class="card-title">评测列表</span>
          <div class="card-header-right">
            <el-pagination small @current-change="handleCurrentChange"
              :current-page="currentPage" :page-size="20"
              layout="total, prev, pager, next" :total="total" hide-on-single-page />
            <el-button-group>
              <el-button type="success" size="small" @click="mySub">
                <el-icon class="el-icon--left"><UserFilled /></el-icon>我的提交
              </el-button>
              <el-button type="primary" size="small" @click="all">
                <el-icon class="el-icon--left"><Refresh /></el-icon>刷新
              </el-button>
            </el-button-group>
          </div>
        </div>
      </template>

      <!-- Filter bar -->
      <div class="filter-bar">
        <el-input v-model="filter.pid"  placeholder="题目编号" style="width:100px" @keyup.enter="all" size="small" />
        <el-input v-model="filter.name" placeholder="用户名"   style="width:120px" @keyup.enter="all" size="small" />
        <el-input v-model="filter.score" placeholder="分数"    style="width:80px"  @keyup.enter="all" size="small" />
        <el-select v-model="filter.res"  placeholder="评测结果" style="width:180px" size="small">
          <el-option v-for="item in options" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select v-model="filter.lang" placeholder="提交语言" style="width:140px" size="small">
          <el-option v-for="l in $store.state.langList" :key="l.id" :label="l.des" :value="l.id" />
        </el-select>
        <el-input v-if="queryAll" v-model="filter.cid" placeholder="比赛id" style="width:80px" size="small" />
        <span v-if="$store.state.gid >= 2" class="toggle-label">
          比赛提交：
          <el-switch v-model="queryAll" active-text="显示" inactive-text="隐藏" @change="all" />
        </span>
        <el-button-group>
          <el-button type="primary" size="small" @click="all">筛选</el-button>
          <el-button type="success" size="small" @click="clear">全部</el-button>
        </el-button-group>
      </div>

      <div class="table-scroll">
        <el-table
          :data="submissionList"
          height="600px"
          :header-cell-style="{ textAlign:'center', background:'#f5f7fa' }"
          :cell-style="cellStyle"
          :row-class-name="tableRowClassName"
          v-loading="!finished"
          style="width:100%; min-width:700px"
        >
          <el-table-column prop="sid" label="#" width="70" align="center" />
          <el-table-column label="题目" min-width="160">
            <template #default="scope">
              <router-link class="rlink" :to="'/problem/'+scope.row.pid">{{ scope.row.title }}</router-link>
              <el-icon id="hidden" v-if="!scope.row.isPublic"><Hide /></el-icon>
            </template>
          </el-table-column>
          <el-table-column label="提交者" width="110" align="center">
            <template #default="scope">
              <router-link class="rlink" :to="'/user/'+scope.row.uid">{{ scope.row.name }}</router-link>
            </template>
          </el-table-column>
          <el-table-column label="评测状态" width="160" align="center">
            <template #default="scope">
              <span style="cursor:pointer" @click="go2s(scope)">{{ scope.row.judgeResult }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="score" label="分数" width="70" align="center" />
          <el-table-column label="用时" width="90" align="center" class-name="hide-on-mobile">
            <template #default="scope">{{ scope.row.time }} ms</template>
          </el-table-column>
          <el-table-column label="内存" width="90" align="center" class-name="hide-on-mobile">
            <template #default="scope">{{ scope.row.memory }}</template>
          </el-table-column>
          <el-table-column label="语言" width="140" align="center" class-name="hide-on-mobile">
            <template #default="scope">
              {{ $store.state.langList[scope.row.lang]?.des }} / {{ scope.row.codeLength }} B
            </template>
          </el-table-column>
          <el-table-column prop="submitTime" label="提交时间" width="155" align="center" fixed="right" />
          <el-table-column prop="machine"    label="评测机"   width="90"  align="center" fixed="right" class-name="hide-on-mobile" />
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<script>
import axios from "axios";
import { resColor, scoreColor } from '@/assets/common';
import qs from 'qs';

export default {
  name: 'submissionList',
  data() {
    return {
      submissionList: [], total: 0, finished: false, currentPage: 1,
      filter: { pid: null, name: null, res: null, score: null, cid: null, lang: null },
      queryAll: false,
      options: [
        { value: -1, label: '不限结果' }, { value: 4,  label: 'Accepted'              },
        { value: 5,  label: 'Wrong Answer'              }, { value: 6,  label: 'Time Limit Exceeded'    },
        { value: 7,  label: 'Memory Limit Exceeded'     }, { value: 8,  label: 'Runtime Error'          },
        { value: 9,  label: 'Segmentation Fault'        }, { value: 3,  label: 'Compilation Error'      },
        { value: 10, label: 'Output Limit Exceeded'     }, { value: 0,  label: 'Waiting'                },
        { value: 1,  label: 'Pending'                   }, { value: 2,  label: 'Rejudging'              },
        { value: 11, label: 'Dangerous System Call'     }, { value: 12, label: 'System Error'           },
        { value: 13, label: 'Canceled'                  },
      ],
    };
  },
  methods: {
    all() {
      this.finished = false;
      let param = {}, url = location.pathname;
      if (this.filter.name)  param.name  = this.filter.name;
      if (this.filter.pid)   param.pid   = this.filter.pid;
      if (this.filter.cid)   param.cid   = this.filter.cid;
      if (this.filter.score !== null) param.score = this.filter.score;
      if (this.filter.res   !== null) param.res   = this.filter.res;
      if (this.filter.lang  !== null) param.lang  = this.filter.lang;
      if (this.queryAll && this.$store.state.gid > 1) param.queryAll = true;
      if (this.currentPage > 1) param.pageId = this.currentPage;
      const nurl = qs.stringify(param);
      if (nurl) url += ('?' + nurl);
      history.replaceState(history.state, null, url);
      axios.post('/api/judge/getSubmissionList', {
        pageId: this.currentPage, pid: this.filter.pid, cid: this.filter.cid,
        name: this.filter.name, score: this.filter.score,
        judgeRes: this.filter.res === -1 ? null : this.filter.res,
        lang: this.filter.lang, queryAll: this.queryAll,
      }).then(res => {
        this.submissionList = res.data.data;
        this.total = res.data.total;
        this.finished = true;
      }).catch(err => { this.$message.error('获取提交记录失败 ' + err.message); });
    },
    clear() {
      this.filter = { pid: null, name: null, res: null, score: null, cid: null, lang: null };
      this.all();
    },
    mySub() { this.filter.name = this.$store.state.name; this.all(); },
    handleCurrentChange(val) { this.currentPage = val; this.all(); },
    tableRowClassName({ row }) { return row.cid ? 'warning' : ''; },
    go2s(scope) {
      if (!scope.row.cid) this.$router.push('/submission/' + scope.row.sid);
      else this.$router.push({ path: '/submission/' + scope.row.sid, query: { isContest: true } });
    },
    cellStyle({ row, columnIndex }) {
      const s = { textAlign: 'center' };
      if (columnIndex === 3) { s.fontWeight = 500; s.color = resColor[row.judgeResult]; }
      if (columnIndex === 4) { s.fontWeight = 500; s.color = scoreColor[Math.floor(row.score / 10)]; }
      return s;
    },
  },
  mounted() {
    const q = this.$route.query;
    if (q.res)   this.filter.res   = parseInt(q.res);
    if (q.score) this.filter.score = parseInt(q.score);
    if (q.name)  this.filter.name  = q.name;
    if (q.pid)   this.filter.pid   = q.pid;
    if (q.cid)   this.filter.cid   = q.cid;
    if (q.lang)  this.filter.lang  = parseInt(q.lang);
    if (q.queryAll && this.$store.state.gid > 1) this.queryAll = true;
    if (q.pageId) this.currentPage = parseInt(q.pageId);
    this.all();
  },
};
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-weight: bolder;
  color: #3f3f3f;
}
.card-title { font-size: 15px; }
.card-header-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}
.toggle-label { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }

.table-scroll { overflow-x: auto; }
</style>
