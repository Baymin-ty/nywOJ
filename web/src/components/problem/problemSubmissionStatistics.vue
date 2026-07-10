<template>
  <div class="statistics-page">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <div>
            <div class="eyebrow">PROBLEM #{{ pid }}</div>
            <div class="title">{{ problem.title || '提交统计榜' }}</div>
          </div>
          <el-button-group>
            <el-button plain icon="Back" @click="$router.push('/problem/' + pid)">返回题目</el-button>
            <el-button type="primary" icon="Refresh" :loading="loading" @click="loadData">刷新</el-button>
          </el-button-group>
        </div>
      </template>

      <div class="toolbar">
        <el-radio-group v-model="type" @change="switchType">
          <el-radio-button v-for="item in statTypes" :key="item.value" :label="item.value">
            {{ item.label }}
          </el-radio-button>
        </el-radio-group>
        <el-pagination
          layout="total, prev, pager, next"
          :page-size="pageSize"
          :current-page="currentPage"
          :total="total"
          @current-change="handleCurrentChange"
        />
      </div>

      <div class="score-strip">
        <div class="score-card">
          <div class="score-label">满分提交</div>
          <div class="score-value">{{ scoreSummary.full }}</div>
        </div>
        <div class="score-card">
          <div class="score-label">部分分提交</div>
          <div class="score-value">{{ scoreSummary.partial }}</div>
        </div>
        <div class="score-card">
          <div class="score-label">零分提交</div>
          <div class="score-value">{{ scoreSummary.zero }}</div>
        </div>
      </div>

      <el-table :data="submissions" v-loading="loading" height="600px" :cell-style="cellStyle" empty-text="暂无 AC 统计记录">
        <el-table-column prop="rank" label="#" width="80" />
        <el-table-column prop="name" label="用户" width="150">
          <template #default="scope">
            <router-link class="rlink" :to="'/user/' + scope.row.uid">
              {{ scope.row.name }}
            </router-link>
          </template>
        </el-table-column>
        <el-table-column prop="sid" label="提交" width="100">
          <template #default="scope">
            <router-link class="rlink" :to="'/submission/' + scope.row.sid">
              #{{ scope.row.sid }}
            </router-link>
          </template>
        </el-table-column>
        <el-table-column prop="judgeResult" label="状态" width="150" />
        <el-table-column prop="score" label="分数" width="80" />
        <el-table-column label="榜单指标" width="150">
          <template #default="scope">
            {{ metricText(scope.row) }}
          </template>
        </el-table-column>
        <el-table-column prop="time" label="总用时" width="100">
          <template #default="scope">{{ scope.row.time }} ms</template>
        </el-table-column>
        <el-table-column prop="memory" label="内存" width="100" />
        <el-table-column prop="codeLength" label="语言 / 代码长度" min-width="180">
          <template #default="scope">
            <span v-if="scope.row.lang == null">答案 / {{ scope.row.codeLength }} B</span>
            <span v-else>{{ langName(scope.row.lang) }} / {{ scope.row.codeLength }} B</span>
          </template>
        </el-table-column>
        <el-table-column prop="submitTime" label="提交时间" width="185" />
        <el-table-column prop="machine" label="评测机" min-width="110" />
      </el-table>
    </el-card>
  </div>
</template>

<script>
import axios from 'axios';
import { resColor, scoreColor } from '@/assets/common';

const STAT_TYPES = [
  { value: 'Fastest', path: 'fastest', label: '最快通过' },
  { value: 'MinAnswerSize', path: 'minanswersize', label: '最短代码' },
  { value: 'MinMemory', path: 'minmemory', label: '最低内存' },
  { value: 'Earliest', path: 'earliest', label: '最早通过' },
];

const STAT_TYPE_ALIASES = {
  shortest: 'MinAnswerSize',
  min: 'MinMemory',
};

const pathToType = (value) => {
  const raw = String(value || '').toLowerCase();
  if (STAT_TYPE_ALIASES[raw]) return STAT_TYPE_ALIASES[raw];
  return (STAT_TYPES.find((item) => item.path === raw || item.value.toLowerCase() === raw) || STAT_TYPES[0]).value;
};

export default {
  name: 'problemSubmissionStatistics',
  data() {
    return {
      pid: 0,
      type: 'Fastest',
      currentPage: 1,
      pageSize: 20,
      total: 0,
      loading: false,
      submissions: [],
      scores: new Array(101).fill(0),
      problem: {},
      statTypes: STAT_TYPES,
    };
  },
  computed: {
    scoreSummary() {
      const zero = Number(this.scores[0] || 0);
      const full = Number(this.scores[100] || 0);
      const partial = this.scores.reduce((sum, count, score) => {
        if (score <= 0 || score >= 100) return sum;
        return sum + Number(count || 0);
      }, 0);
      return { zero, partial, full };
    },
  },
  methods: {
    async ensureLangs() {
      if (Object.keys(this.$store.state.langList || {}).length) return;
      try {
        const res = await axios.post('/api/judge/getLangs');
        if (res.status === 200) this.$store.state.langList = res.data.data || {};
      } catch (_) {
        this.$store.state.langList = {};
      }
    },
    typePath(type) {
      return (STAT_TYPES.find((item) => item.value === type) || STAT_TYPES[0]).path;
    },
    switchType() {
      this.currentPage = 1;
      this.$router.replace(`/problem/statistics/${this.pid}/${this.typePath(this.type)}`);
      this.loadData();
    },
    handleCurrentChange(page) {
      this.currentPage = page;
      this.loadData();
    },
    async loadData() {
      this.loading = true;
      try {
        const res = await axios.post('/api/judge/querySubmissionStatistics', {
          pid: this.pid,
          statisticsType: this.type,
          pageId: this.currentPage,
          pageSize: this.pageSize,
        });
        if (res.status === 200) {
          this.submissions = res.data.data || res.data.submissions || [];
          this.total = res.data.total || res.data.count || 0;
          this.scores = res.data.scores || new Array(101).fill(0);
          this.problem = res.data.problem || this.problem || {};
        } else {
          this.$message.error(res.data.message || '加载统计榜失败');
        }
      } catch (err) {
        const msg = err && err.response && err.response.data && err.response.data.message;
        this.$message.error(msg || '加载统计榜失败');
      } finally {
        this.loading = false;
      }
    },
    metricText(row) {
      if (this.type === 'Fastest') return `${row.time} ms`;
      if (this.type === 'MinMemory') return row.memory;
      if (this.type === 'MinAnswerSize') return `${row.codeLength} B`;
      if (this.type === 'Earliest') return row.submitTime;
      return row.metricValue;
    },
    langName(id) {
      const row = (this.$store.state.langList || {})[id];
      return row ? row.des : `Lang ${id}`;
    },
    cellStyle({ row, columnIndex }) {
      const style = { textAlign: 'center' };
      if (columnIndex === 3) {
        style.fontWeight = 600;
        style.color = resColor[row.judgeResult] || '#606266';
      }
      if (columnIndex === 4) {
        style.fontWeight = 600;
        style.color = scoreColor[Math.floor(Number(row.score || 0) / 10)] || '#606266';
      }
      return style;
    },
  },
  async mounted() {
    this.pid = Number(this.$route.params.pid);
    this.type = pathToType(this.$route.params.type);
    if (!Number.isSafeInteger(this.pid) || this.pid <= 0) {
      this.$router.push('/problem');
      return;
    }
    await this.ensureLangs();
    await this.loadData();
  },
};
</script>

<style scoped>
.statistics-page {
  max-width: 1280px;
  margin: 0 auto;
  text-align: center;
}

.box-card {
  margin: 10px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 36px;
  text-align: left;
}

.eyebrow {
  color: #909399;
  font-size: 12px;
  font-weight: 700;
}

.title {
  color: #303133;
  font-size: 20px;
  font-weight: 700;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.score-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.score-card {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px;
  background: #fafafa;
}

.score-label {
  color: #909399;
  font-size: 13px;
}

.score-value {
  margin-top: 4px;
  color: #303133;
  font-size: 24px;
  font-weight: 700;
}

@media (max-width: 768px) {
  .card-header,
  .toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .score-strip {
    grid-template-columns: 1fr;
  }
}
</style>
