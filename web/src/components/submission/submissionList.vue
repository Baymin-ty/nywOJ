<template>
  <div class="submission-page">
    <div class="sub-panel">
      <div class="sub-header">
        <div class="sub-title-wrap">
          <span class="sub-title">评测记录</span>
          <span class="sub-count">{{ total }} 条</span>
        </div>
        <div class="sub-actions">
          <span v-if="$can('submission.view.any')" class="contest-toggle">
            比赛提交
            <el-switch v-model="queryAll" @change="all" />
          </span>
          <el-button-group>
            <el-button type="success" plain @click="mySub">
              <el-icon class="el-icon--left">
                <UserFilled />
              </el-icon>
              我的提交
            </el-button>
            <el-popconfirm v-if="canBulkRejudge" confirm-button-text="确认" cancel-button-text="取消"
              :title="`确认批量重测选中的 ${selectedSids.length} 条提交？`" @confirm="bulkRejudge">
              <template #reference>
                <el-button type="warning" plain :disabled="selectedSids.length === 0">
                  批量重测
                </el-button>
              </template>
            </el-popconfirm>
            <el-button type="primary" plain @click="all">
              <el-icon class="el-icon--left">
                <Refresh />
              </el-icon>
              刷新
            </el-button>
          </el-button-group>
        </div>
      </div>

      <div class="filter-bar">
        <el-input v-model="filter.pid" clearable class="f-pid" placeholder="题目编号"
          @keyup.enter="all" @clear="all" />
        <el-input v-model="filter.name" clearable class="f-name" placeholder="用户名"
          @keyup.enter="all" @clear="all" />
        <el-input v-model="filter.score" clearable class="f-score" placeholder="分数"
          @keyup.enter="all" @clear="all" />
        <el-select v-model="filter.res" clearable class="f-res" placeholder="评测结果" @change="all">
          <el-option v-for="item in options" :key="item.value" :label="item.label" :value="item.value">
            <span class="opt-dot" :style="{ background: item.value === -1 ? '#c0c4cc' : (resColor[item.label] || '#c0c4cc') }" />
            {{ item.label }}
          </el-option>
        </el-select>
        <el-select v-model="filter.lang" clearable class="f-lang" placeholder="提交语言" @change="all">
          <el-option v-for="l in $store.state.langList" :key="l.id" :label="l.des" :value="l.id" />
        </el-select>
        <el-input v-if="queryAll" v-model="filter.cid" clearable class="f-cid" placeholder="比赛 ID"
          @keyup.enter="all" @clear="all" />
        <el-button type="primary" @click="all">筛选</el-button>
        <el-button @click="clear">重置</el-button>
      </div>

      <el-table ref="table" class="sub-table" :data="submissionList"
        :header-cell-style="{ textAlign: 'center' }" :row-class-name="tableRowClassName"
        v-loading="!finished" @selection-change="onSelectionChange" @row-click="onRowClick">
        <el-table-column v-if="canBulkRejudge" type="selection" width="46" fixed />
        <el-table-column prop="sid" label="#" width="80" align="center">
          <template #default="scope">
            <span class="cell-mono cell-muted">{{ scope.row.sid }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="题目" min-width="220" align="center" show-overflow-tooltip>
          <template #default="scope">
            <router-link class="rlink" :to="'/problem/' + scope.row.pid">
              {{ scope.row.title }}
            </router-link>
            <el-icon id="hidden" v-if="!scope.row.problemPublic">
              <Hide />
            </el-icon>
            <el-tag v-if="!scope.row.isPublic" class="visibility-tag" type="danger" size="small">
              私有提交
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="提交者" width="140" align="center" show-overflow-tooltip>
          <template #default="scope">
            <router-link class="rlink" :to="'/user/' + scope.row.uid">
              {{ scope.row.name }}
            </router-link>
          </template>
        </el-table-column>
        <el-table-column prop="judgeResult" label="评测状态" width="210" align="center" show-overflow-tooltip>
          <template #default="scope">
            <span class="res-pill" :style="pillStyle(scope.row.judgeResult)">
              <span v-if="isLiveResult(scope.row.judgeResult)" class="live-dot" />
              {{ scope.row.judgeResult }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="score" label="分数" width="70" align="center">
          <template #default="scope">
            <span class="score-text" :style="{ color: scoreColor[Math.floor(scope.row.score / 10)] }">
              {{ scope.row.score }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="总用时" width="95" align="center">
          <template #default="scope">
            <span class="cell-mono cell-muted">{{ scope.row.time }} ms</span>
          </template>
        </el-table-column>
        <el-table-column label="内存" width="100" align="center">
          <template #default="scope">
            <span class="cell-mono cell-muted">{{ scope.row.memory }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="codeLength" label="语言 / 代码长度" width="200" align="center" show-overflow-tooltip>
          <template #default="scope">
            <span class="cell-mono cell-muted">{{ langText(scope.row) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="submitTime" label="提交时间" fixed="right" width="180" align="center" show-overflow-tooltip>
          <template #default="scope">
            <span class="cell-mono cell-muted">{{ scope.row.submitTime }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="machine" label="评测机" fixed="right" min-width="110" align="center" show-overflow-tooltip>
          <template #default="scope">
            <span class="cell-mono cell-muted">{{ scope.row.machine || '-' }}</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="sub-footer">
        <el-pagination background @current-change="handleCurrentChange" :current-page="currentPage"
          :page-size="20" layout="total, prev, pager, next" :total="total" />
      </div>
    </div>
  </div>
</template>

<script>
import axios from "axios"
import { resColor, scoreColor } from '@/assets/common'
import qs from 'qs'

const LIVE_STATES = new Set(['Waiting', 'Pending', 'Rejudging']);
// el-select clearable emits '' — normalize both '' and undefined to null so
// URL sync and the API payload stay clean.
const nz = (v) => (v === '' || v == null ? null : v);

export default {
  name: 'submissionList',
  data() {
    return {
      resColor,
      scoreColor,
      submissionList: [],
      total: 0,
      finished: false,
      currentPage: 1,
      selectedSids: [],
      filter: {
        pid: null,
        name: null,
        res: null,
        score: null,
        cid: null,
        lang: null
      },
      queryAll: false,
      options: [{
        value: -1,
        label: '不限结果',
      }, {
        value: 4,
        label: 'Accepted',
      }, {
        value: 15,
        label: 'Partially Correct',
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
        value: 16,
        label: 'Judgement Failed',
      }, {
        value: 13,
        label: 'Canceled',
      }],
    }
  },
  computed: {
    canBulkRejudge() {
      return this.$can('submission.rejudge.any');
    },
  },
  methods: {
    isLiveResult(r) {
      return LIVE_STATES.has(r);
    },
    pillStyle(result) {
      const c = resColor[result] || '#909399';
      return {
        color: c,
        background: c + '14',
        borderColor: c + '3D',
      };
    },
    langText(row) {
      if (row.lang == null) return `答案 / ${row.codeLength} B`;
      const l = (this.$store.state.langList || {})[row.lang];
      return `${l ? l.des : '未知'} / ${row.codeLength} B`;
    },
    all() {
      this.finished = false;
      this.selectedSids = [];
      if (this.$refs.table && typeof this.$refs.table.clearSelection === 'function') {
        this.$refs.table.clearSelection();
      }
      const f = {
        pid: nz(this.filter.pid),
        name: nz(this.filter.name),
        score: nz(this.filter.score),
        res: nz(this.filter.res),
        cid: nz(this.filter.cid),
        lang: nz(this.filter.lang),
      };
      let param = {}, url = location.pathname;
      if (f.name) param.name = f.name;
      if (f.pid) param.pid = f.pid;
      if (f.cid) param.cid = f.cid;
      if (f.score !== null) param.score = f.score;
      if (f.res !== null) param.res = f.res;
      if (f.lang !== null) param.lang = f.lang;
      if (this.queryAll && this.$can('submission.view.any')) param.queryAll = true;
      if (this.currentPage > 1)
        param.pageId = this.currentPage;
      let nurl = qs.stringify(param);
      if (nurl) url += ('?' + nurl);
      history.state.current = url;
      history.replaceState(history.state, null, url);
      axios.post('/api/judge/getSubmissionList', {
        pageId: this.currentPage,
        pid: f.pid,
        cid: f.cid,
        name: f.name,
        score: f.score,
        judgeRes: (f.res === -1 ? null : f.res),
        lang: f.lang,
        queryAll: this.queryAll
      }).then(res => {
        this.submissionList = res.data.data;
        this.total = res.data.total;
        this.finished = true;
      }).catch(err => {
        this.$message.error('获取提交记录失败' + err.message);
      });
    },
    onSelectionChange(rows) {
      this.selectedSids = (rows || []).map(r => r.sid);
    },
    bulkRejudge() {
      const sids = [...this.selectedSids];
      if (!sids.length) return;
      axios.post('/api/judge/reJudgeBatch', { sids }).then(res => {
        const data = res.data || {};
        const accepted = data.accepted ?? 0;
        const denied = (data.denied || []).length;
        if (denied) {
          this.$message.warning(`已重测 ${accepted} 条，${denied} 条因权限不足被跳过`);
        } else {
          this.$message.success(`已重测 ${accepted} 条提交`);
        }
        this.all();
      }).catch(err => {
        this.$message.error('批量重测失败' + err.message);
      });
    },
    clear() {
      this.filter.name = this.filter.pid = this.filter.res = this.filter.score = this.filter.cid = this.filter.lang = null;
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
    onRowClick(row, column, event) {
      // Links / checkbox inside the row keep their own behavior.
      if (column && column.type === 'selection') return;
      if (event && event.target && event.target.closest &&
        event.target.closest('a, .el-checkbox')) return;
      this.go2s(row);
    },
    go2s(row) {
      if (!row.cid)
        this.$router.push('/submission/' + row.sid);
      else
        this.$router.push({ path: '/submission/' + row.sid, query: { isContest: true } })
    },
  },
  mounted() {
    let query = this.$route.query;
    if (query.res) this.filter.res = parseInt(query.res);
    if (query.score) this.filter.score = parseInt(query.score);
    if (query.name) this.filter.name = query.name;
    if (query.pid) this.filter.pid = query.pid;
    if (query.cid) this.filter.cid = query.cid;
    if (query.lang) this.filter.lang = parseInt(query.lang);
    if (query.queryAll && this.$can('submission.view.any')) this.queryAll = true;
    if (query.pageId) this.currentPage = parseInt(query.pageId);
    this.all();
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.submission-page {
  margin: 0 auto;
  max-width: 1680px;
}

.sub-panel {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 12px;
  padding: 16px 18px 14px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04);
}

.sub-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.sub-title-wrap {
  display: inline-flex;
  align-items: baseline;
  gap: 10px;
}

.sub-title {
  font-size: 17px;
  font-weight: 800;
  color: #303133;
  letter-spacing: 0.3px;
  white-space: nowrap;
}

.sub-count {
  font-size: 12px;
  color: #909399;
  background: #f4f4f5;
  border-radius: 999px;
  padding: 2px 10px;
  white-space: nowrap;
}

.sub-actions {
  display: inline-flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.contest-toggle {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px;
  margin-bottom: 14px;
  background: #f8fafc;
  border: 1px solid #eef2f7;
  border-radius: 10px;
}

.f-pid { width: 110px; }
.f-name { width: 150px; }
.f-score { width: 90px; }
.f-res { width: 200px; }
.f-lang { width: 160px; }
.f-cid { width: 110px; }

.filter-bar .el-button + .el-button {
  margin-left: 0;
}

.opt-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 8px;
  vertical-align: 1px;
}

.sub-table :deep(.el-table__row) {
  cursor: pointer;
}

.res-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 3px 10px;
  border: 1px solid;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.live-dot {
  position: relative;
  display: inline-block;
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2b85e4;
  box-shadow: 0 0 0 0 rgba(43, 133, 228, 0.55);
  animation: live-pulse 1.4s ease-out infinite;
}

@keyframes live-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(43, 133, 228, 0.55); }
  70%  { box-shadow: 0 0 0 8px rgba(43, 133, 228, 0); }
  100% { box-shadow: 0 0 0 0 rgba(43, 133, 228, 0); }
}

.score-text {
  font-weight: 700;
  font-size: 14px;
}

.cell-mono {
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12.5px;
}

.cell-muted {
  color: #606266;
}

.visibility-tag {
  margin-left: 6px;
  vertical-align: 1px;
}

.sub-footer {
  display: flex;
  justify-content: center;
  padding-top: 14px;
}

@media (max-width: 768px) {
  .sub-panel {
    padding: 12px 10px;
    border-radius: 10px;
  }

  .sub-header {
    justify-content: center;
  }

  .filter-bar {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .filter-bar .el-input,
  .filter-bar .el-select {
    width: 100%;
  }

  .contest-toggle {
    justify-content: center;
  }
}
</style>
