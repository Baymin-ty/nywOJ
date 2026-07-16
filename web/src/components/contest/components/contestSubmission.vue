<template>
  <div class="header">
    <div class="left-controls">
      <el-switch v-model="lastOnly" active-text="Last" inactive-text="All" @change="all" />
      <el-checkbox v-model="selfOnly" label="只看自己" @change="all" />
      <el-checkbox v-if="virtualFinished && !lastOnly" v-model="virtualOnly" label="我的虚拟提交" @change="all" />
    </div>
    <el-pagination v-if="!(lastOnly && selfOnly)" @current-change="handleCurrentChange" :current-page="currentPage"
      :page-size="20" layout="total, prev, pager, next" :total="total"></el-pagination>
    <el-button-group>
      <el-popconfirm v-if="canBulkRejudge" confirm-button-text="确认" cancel-button-text="取消"
        :title="`确认批量重测选中的 ${selectedSids.length} 条提交？`" @confirm="bulkRejudge">
        <template #reference>
          <el-button class="bulk-rejudge-btn" :disabled="selectedSids.length === 0">
            <el-icon class="el-icon--left">
              <RefreshRight />
            </el-icon>
            <span>批量重测</span>
            <span v-if="selectedSids.length" class="bulk-count">{{ selectedSids.length }}</span>
          </el-button>
        </template>
      </el-popconfirm>
      <el-button type="primary" @click="all">
        <el-icon class="el-icon--left">
          <Refresh />
        </el-icon>
        刷新
      </el-button>
    </el-button-group>
  </div>
  <el-table ref="table" :data="submissionList" :header-cell-style="{ textAlign: 'center' }"
    :cell-style="cellStyle" :row-class-name="tableRowClassName" v-loading="!finished"
    @selection-change="onSelectionChange">
    <el-table-column v-if="canBulkRejudge" type="selection" width="46" fixed />
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
    <el-table-column prop="judgeResult" label="评测状态" min-width="15%">
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
    <el-table-column prop="codeLength" label="语言 / 代码长度" min-width="15%">
      <template #default="scope">
        <span v-if="scope.row.lang == null">答案 / {{ scope.row.codeLength }} B</span>
        <span v-else>{{ $store.state.langList[scope.row.lang].des }} / {{ scope.row.codeLength }} B </span>
      </template>
    </el-table-column>
    <el-table-column prop="submitTime" label="提交时间" min-width="16%" />
    <el-table-column prop="machine" label="评测机" min-width="10%" />
  </el-table>
</template>

<script>
import axios from "axios"
import { resColor, scoreColor } from '@/assets/common'
import store from '@/sto/store'

export default {
  name: 'submissionList',
  props: {
    canManage: { type: Boolean, default: false },
    // VP 已结束：显示「我的虚拟提交」开关（VP 进行中服务端自动只回本人虚拟提交）
    virtualFinished: { type: Boolean, default: false },
  },
  data() {
    return {
      submissionList: [],
      currentPage: 1,
      total: 0,
      lastOnly: false,
      finished: false,
      cid: 0,
      selfOnly: false,
      virtualOnly: false,
      selectedSids: [],
    }
  },
  computed: {
    canBulkRejudge() {
      return !!this.canManage || this.$can('submission.rejudge.any');
    },
  },
  methods: {
    all() {
      this.finished = false;
      this.selectedSids = [];
      if (this.$refs.table && typeof this.$refs.table.clearSelection === 'function') {
        this.$refs.table.clearSelection();
      }
      let url = '';
      if (this.lastOnly) url =
        this.selfOnly ? '/api/contest/getSingleUserLastSubmission' :
          '/api/contest/getLastSubmissionList';
      else url = '/api/contest/getSubmissionList'
      axios.post(url, {
        cid: this.cid,
        pageId: this.currentPage,
        uid: this.selfOnly ? this.uid : null,
        virtual: (!this.lastOnly && this.virtualOnly) || undefined,
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
      const resCol = this.canBulkRejudge ? 4 : 3;
      const scoreCol = this.canBulkRejudge ? 5 : 4;
      if (columnIndex === resCol) {
        style['font-weight'] = 500;
        style['color'] = resColor[row.judgeResult];
      }
      if (columnIndex === scoreCol) {
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

.bulk-rejudge-btn {
  font-weight: 650;
  color: #a85d00;
  background: #fff8eb;
  border-color: #e8a23a;
  transition: color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease;
}

.bulk-rejudge-btn:not(.is-disabled):hover,
.bulk-rejudge-btn:not(.is-disabled):focus {
  color: #fff;
  background: #d98200;
  border-color: #d98200;
}

.header :deep(.bulk-rejudge-btn.is-disabled) {
  color: #a8abb2;
  background: #f5f7fa;
  border-color: #dcdfe6;
  opacity: 1;
}

.bulk-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  margin-left: 6px;
  padding: 0 6px;
  color: #fff;
  font-size: 11px;
  line-height: 1;
  background: #d98200;
  border-radius: 999px;
}

.bulk-rejudge-btn:hover .bulk-count,
.bulk-rejudge-btn:focus .bulk-count {
  color: #d98200;
  background: #fff;
}

@media (max-width: 768px) {
  .header {
    height: auto;
    justify-content: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 10px;
  }

  .left-controls {
    width: 100%;
    justify-content: center;
    flex-wrap: wrap;
  }

  .header :deep(.el-pagination) {
    width: 100%;
    justify-content: center;
    flex-wrap: wrap;
  }
}
</style>
