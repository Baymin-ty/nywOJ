<template>
  <el-row style="min-width: 600px;max-width: 1250px; margin: 0 auto;">
    <el-table :data="table" style="margin-bottom:10px;" :header-cell-style="{ textAlign: 'center' }"
      :cell-style="cellStyle2">
      <el-table-column prop="sid" label="#" min-width="5%" />
      <el-table-column prop="title" label="题目" min-width="15%">
        <template #default="scope">
          <router-link class="rlink" :to="!isContest ?
            '/problem/' + scope.row.pid :
            '/contest/' + scope.row.cid + '/problem/' + scope.row.idx">
            {{ scope.row.title }}
          </router-link>
          <el-icon id="hidden" v-if="!scope.row.isPublic && !isContest">
            <Hide />
          </el-icon>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="提交者" min-width="10%">
        <template #default="scope">
          <router-link class="rlink" :to="'/user/' + scope.row.uid">
            {{ scope.row.name }}
          </router-link>
        </template>
      </el-table-column>
      <el-table-column prop="judgeResult" label="评测状态" min-width="14%">
        <template #default="scope">
          <span class="judge-result" :class="{ 'is-live': isLiveResult(scope.row.judgeResult) }">
            <span v-if="isLiveResult(scope.row.judgeResult)" class="live-dot"></span>
            {{ scope.row.judgeResult }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="score" label="分数" min-width="5%">
        <template #default="scope">
          <span> {{ scope.row.score }}</span>
        </template>
      </el-table-column>
      <el-table-column label="总用时" min-width="8%">
        <template #default="scope">
          <span> {{ scope.row.time }} ms</span>
        </template>
      </el-table-column>
      <el-table-column label="内存" min-width="8%">
        <template #default="scope">
          <span> {{ scope.row.memory }} </span>
        </template>
      </el-table-column>
      <el-table-column prop="codeLength" label="语言 / 代码长度" min-width="12%">
        <template #default="scope">
          <span>{{ $store.state.langList[scope.row.lang].des }} / {{ scope.row.codeLength }} B </span>
        </template>
      </el-table-column>
      <el-table-column prop="submitTime" label="提交时间" min-width="13%" />
      <el-table-column prop="machine" label="评测机" min-width="10%" />
    </el-table>
  </el-row>
  <el-row style="text-align: center; margin: 0 auto; max-width: 1250px; min-width: 600px;">
    <el-col :span="24" style="min-width: 400px;margin: 0 auto;">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class=" card-header">
            代码
            <el-button-group>
              <el-popconfirm v-if="canRejudge" confirm-button-text="确认" cancel-button-text="取消" title="确认取消成绩?"
                @confirm="cancelSubmission">
                <template #reference>
                  <el-button type="warning">
                    <el-icon class="el-icon--left">
                      <CloseBold />
                    </el-icon>
                    取消成绩
                  </el-button>
                </template>
              </el-popconfirm>
              <el-popconfirm v-if="canRejudge" confirm-button-text="确认" cancel-button-text="取消" title="确认重新测评?"
                @confirm="reJudge">
                <template #reference>
                  <el-button type="danger">
                    <el-icon class="el-icon--left">
                      <Refresh />
                    </el-icon>
                    重新测评
                  </el-button>
                </template>
              </el-popconfirm>
            </el-button-group>
          </div>
        </template>
        <monacoEditor v-if="hasTaken" :value="code"  :language="$store.state.langList[submissionInfo.lang].lang" @update:value="code = $event" :readOnly="true" />
      </el-card>
    </el-col>
  </el-row>
  <el-row style="text-align: center; margin: 0 auto; max-width: 1250px; min-width: 600px;">
    <el-col :span="24" style="min-width: 400px">
      <el-card class="box-card cases-card" :class="{ 'cases-card--live': isLive }" shadow="hover">
        <template #header>
          <div class="card-header cases-header">
            <span>测试点详情</span>
            <transition name="live-fade">
              <span v-if="isLive" class="live-badge">
                <span class="live-dot"></span>
                <span class="live-text">实时评测中</span>
                <span class="live-count">已完成 {{ caseCount }} 个测试点</span>
              </span>
            </transition>
          </div>
          <div v-if="isLive" class="live-strip"><span></span></div>
        </template>
        <el-table
          v-if="submissionInfo.judgeResult !== 'Compilation Error' && submissionInfo.judgeResult !== 'System Error' && !submissionInfo.done"
          :data="submissionInfo.singleCaseResult" height="auto" :row-class-name="tableRowClassName"
          :cell-style="cellStyle" :header-cell-style="{ textAlign: 'center' }">
          <el-table-column prop="caseId" label="#" min-width="10%" />
          <el-table-column prop="subtaskId" label="子任务" min-width="10%" />
          <el-table-column prop="judgeResult" label="结果" min-width="40%">
            <template #default="scope">
              <span> {{ scope.row.result }} </span>
            </template>
          </el-table-column>
          <el-table-column prop="time" label="用时" min-width="20%">
            <template #default="scope">
              <span> {{ Math.floor(scope.row.time) }} ms</span>
            </template>
          </el-table-column>
          <el-table-column prop="memory" label="内存" min-width="20%">
            <template #default="scope">
              <span> {{ scope.row.memory }} </span>
            </template>
          </el-table-column>
        </el-table>
        <caseDisplay
          v-if="submissionInfo.judgeResult !== 'Compilation Error' && submissionInfo.judgeResult !== 'System Error' && submissionInfo.subtaskInfo"
          :subtaskInfo="submissionInfo.subtaskInfo" />
        <v-md-preview
          v-show="submissionInfo.judgeResult === 'Compilation Error' || submissionInfo.judgeResult === 'System Error'"
          :text="submissionInfo.compileResult" />
      </el-card>
    </el-col>
  </el-row>
  <el-row style="text-align: center; margin: 0 auto; max-width: 1250px; min-width: 600px;">
    <el-col :span="24" style="min-width: 400px">
      <el-card class="box-card log-card" shadow="hover">
        <template #header>
          <div class="log-header">
            <div class="log-title">
              评测日志
              <span v-if="isLive" class="log-live"><span class="log-live-dot" />LIVE</span>
              <span class="log-count">{{ filteredLogEntries.length }}/{{ logEntries.length }}</span>
            </div>
            <el-input v-model="logFilter" size="small" clearable placeholder="过滤事件 / 内容" class="log-filter" />
          </div>
        </template>
        <div v-if="submissionInfo.judgeLogRestricted" class="log-empty">比赛进行中，评测日志暂不可见。</div>
        <div v-else-if="!logEntries.length" class="log-empty">暂无评测日志</div>
        <el-timeline v-else class="log-timeline">
          <el-timeline-item
            v-for="(e, i) in filteredLogEntries"
            :key="i"
            :type="logItemType(e.event)"
            :timestamp="formatLogTime(e.ts)"
          >
            <div class="log-item">
              <div class="log-item-head">
                <span class="log-event">{{ logEventLabel(e.event) }}</span>
                <span v-if="e.event" class="log-event-key">{{ e.event }}</span>
              </div>
              <div class="log-item-body">
                <pre v-if="e.meta" class="log-json">{{ formatLogPayload(e.meta) }}</pre>
                <pre v-if="e.data" class="log-json">{{ formatLogPayload(e.data) }}</pre>
              </div>
            </div>
          </el-timeline-item>
        </el-timeline>
      </el-card>
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios';
import { resColor, scoreColor } from '@/assets/common'
import monacoEditor from '@/components/monacoEditor.vue'
import caseDisplay from './caseDisplay.vue'

const LIVE_STATES = new Set(['Waiting', 'Pending', 'Rejudging']);

export default {
  name: "submissionView",
  data() {
    return {
      table: [],
      submissionInfo: {},
      code: '',
      hasTaken: false,
      isContest: false,
      canRejudge: false,
      mounted: false,
      stream: null,
      streamRetry: 0,
      retryTimer: null,
      // Tracks caseIds present in the previous payload so we can flash newly
      // arrived rows in the test-points table without re-rendering everything.
      seenCaseIds: new Set(),
      // caseId -> timestamp; rows whose id is here for the next ~1s get the
      // 'is-new' class for a fade/flash animation.
      newCaseIds: new Set(),
      logFilter: '',
    }
  },
  computed: {
    isLive() {
      return LIVE_STATES.has(this.submissionInfo.judgeResult);
    },
    caseCount() {
      const list = this.submissionInfo.singleCaseResult;
      return Array.isArray(list) ? list.length : 0;
    },
    logEntries() {
      return Array.isArray(this.submissionInfo.judgeLog) ? this.submissionInfo.judgeLog : [];
    },
    filteredLogEntries() {
      const q = this.logFilter.trim().toLowerCase();
      if (!q) return this.logEntries;
      return this.logEntries.filter((e) => {
        const hay = JSON.stringify(e).toLowerCase();
        return hay.includes(q);
      });
    },
  },
  components: {
    monacoEditor,
    caseDisplay
  },
  methods: {
    isLiveResult(r) { return LIVE_STATES.has(r); },
    tableRowClassName(obj) {
      const classes = [];
      if (obj.row.result == 'Accepted') classes.push('success');
      if (this.newCaseIds.has(obj.row.caseId)) classes.push('is-new');
      return classes.join(' ');
    },
    cellStyle({ row, columnIndex }) {
      let style = {};
      style['textAlign'] = 'center';
      if (columnIndex === 2) {
        style['font-weight'] = 500;
        style['color'] = resColor[row.result];
      }
      return style;
    },
    cellStyle2({ row, columnIndex }) {
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
    formatLogTime(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return ts;
      const pad = (n) => (n < 10 ? '0' + n : n);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    },
    logEventLabel(event) {
      const map = {
        start: '开始',
        'compile.start': '编译开始',
        'compile.result': '编译完成',
        'compile.error': '编译错误',
        'compile.skip': '编译跳过',
        'spj.compile.start': 'SPJ 编译开始',
        'spj.compile.result': 'SPJ 编译完成',
        'spj.compile.error': 'SPJ 编译错误',
        'spj.run.error': 'SPJ 运行错误',
        'case.start': '测试点开始',
        'case.run': '测试点运行',
        'case.compare': '对拍结果',
        'case.error': '测试点错误',
        finish: '评测完成',
        error: '系统错误',
      };
      return map[event] || '日志事件';
    },
    logItemType(event) {
      if (!event) return 'info';
      if (event.includes('error')) return 'danger';
      if (event === 'finish') return 'success';
      if (event.includes('compile')) return 'primary';
      if (event.includes('case.compare')) return 'success';
      if (event.includes('case')) return 'warning';
      return 'info';
    },
    formatLogPayload(payload) {
      if (payload == null) return '';
      if (typeof payload === 'string') return payload;
      try { return JSON.stringify(payload, null, 2); }
      catch (_e) { return String(payload); }
    },
    applySubmissionInfo(info) {
      // Flag any caseIds that weren't in the previous payload — the table
      // row class hook reads `newCaseIds` and adds `.is-new` so CSS can flash
      // them in. Cleared after the animation duration so subsequent steady
      // refreshes don't keep flashing.
      const prevIds = this.seenCaseIds;
      const nextIds = new Set();
      const justArrived = [];
      const cases = Array.isArray(info.singleCaseResult) ? info.singleCaseResult : [];
      for (const c of cases) {
        nextIds.add(c.caseId);
        if (!prevIds.has(c.caseId)) justArrived.push(c.caseId);
      }
      this.seenCaseIds = nextIds;
      if (justArrived.length) {
        for (const id of justArrived) this.newCaseIds.add(id);
        // Re-trigger reactivity for the row-class-name hook by re-assigning.
        this.newCaseIds = new Set(this.newCaseIds);
        setTimeout(() => {
          for (const id of justArrived) this.newCaseIds.delete(id);
          this.newCaseIds = new Set(this.newCaseIds);
        }, 1100);
      }

      info.compileResult = "```\n" + info.compileResult + "\n```";
      this.submissionInfo = info;
      this.code = info.code;
      this.hasTaken = true;
      this.canRejudge = !!info.canRejudge;
      this.table = [info];
    },
    openStream() {
      this.closeStream();
      const path = this.isContest ? '/api/contest/streamSubmission' : '/api/judge/streamSubmission';
      const url = `${path}?sid=${encodeURIComponent(this.sid)}`;
      const es = new EventSource(url, { withCredentials: true });
      this.stream = es;

      const onPayload = (ev) => {
        try { this.applySubmissionInfo(JSON.parse(ev.data)); }
        catch (e) { console.error('SSE payload parse err', e); }
      };
      es.addEventListener('snapshot', onPayload);
      es.addEventListener('update', onPayload);

      es.onerror = () => {
        if (!this.mounted) return;
        // EventSource has built-in reconnection while readyState===CONNECTING.
        // If it lands in CLOSED (e.g. server returned non-2xx), back off and
        // re-open manually so a transient blip doesn't strand the page on
        // stale data.
        if (es.readyState === EventSource.CLOSED && this.stream === es) {
          this.streamRetry = Math.min(this.streamRetry + 1, 5);
          const delay = 1000 * this.streamRetry;
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (this.mounted) this.openStream();
          }, delay);
        }
      };
    },
    closeStream() {
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      if (this.stream) {
        this.stream.close();
        this.stream = null;
      }
    },
    async reJudge() {
      // The SSE connection is already open; the worker's progress events will
      // stream in once it picks up the requeued submission, so no manual
      // re-fetch is needed here.
      try {
        await axios.post('/api/judge/reJudge', { sid: this.sid });
        this.$message.success('已重新测评');
      } catch (err) {
        const msg = err && err.response && err.response.data && err.response.data.message;
        this.$message.error(msg || err.message || '重新测评失败');
      }
    },
    cancelSubmission() {
      axios.post('/api/judge/cancelSubmission', { sid: this.sid }).then(res => {
        if (res.status === 200) this.$message.success('取消成功');
        else this.$message.error('取消失败');
      });
    }
  },
  async mounted() {
    this.mounted = true;
    this.sid = this.$route.params.sid;
    if (this.$route.query.isContest) this.isContest = true;
    document.title = "提交记录";
    this.openStream();
  },
  unmounted() {
    this.mounted = false;
    this.closeStream();
  }
}
</script>

<style scoped>
.box-card {
  margin: 10px;
  text-align: left;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
}

.sub {
  padding: 15px;
  border-style: solid;
  border-radius: 5px;
}

.judge-result {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.judge-result.is-live {
  letter-spacing: 0.3px;
}

.live-dot {
  position: relative;
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2b85e4;
  box-shadow: 0 0 0 0 rgba(43, 133, 228, 0.55);
  animation: live-pulse 1.4s ease-out infinite;
}

@keyframes live-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(43, 133, 228, 0.55); }
  70%  { box-shadow: 0 0 0 10px rgba(43, 133, 228, 0); }
  100% { box-shadow: 0 0 0 0 rgba(43, 133, 228, 0); }
}

.cases-header {
  position: relative;
}

.live-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #2b85e4;
  background: rgba(43, 133, 228, 0.08);
  border: 1px solid rgba(43, 133, 228, 0.25);
  border-radius: 999px;
  letter-spacing: 0.3px;
}

.live-text {
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.live-count {
  color: #606266;
  font-weight: 500;
}

.live-strip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  overflow: hidden;
  background: rgba(43, 133, 228, 0.08);
}

.live-strip > span {
  display: block;
  height: 100%;
  width: 30%;
  background: linear-gradient(90deg,
    rgba(43, 133, 228, 0)   0%,
    rgba(43, 133, 228, 0.85) 50%,
    rgba(43, 133, 228, 0)   100%);
  animation: live-slide 1.6s linear infinite;
}

@keyframes live-slide {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}

.live-fade-enter-active,
.live-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.live-fade-enter-from,
.live-fade-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

.cases-card--live :deep(.el-card__header) {
  position: relative;
}

/* New test-case rows fade-in with a brief blue wash so streaming is obvious. */
.cases-card :deep(.el-table__row.is-new) {
  animation: row-flash 1s ease-out;
}

@keyframes row-flash {
  0%   { background-color: rgba(43, 133, 228, 0.18); }
  60%  { background-color: rgba(43, 133, 228, 0.08); }
  100% { background-color: transparent; }
}

.log-empty {
  padding: 18px;
  color: #909399;
  font-size: 12px;
}

.log-card :deep(.el-card__header) {
  background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%);
  border-bottom: 1px solid #e2e8f0;
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.log-title {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: "Space Grotesk", "IBM Plex Sans", "Helvetica Neue", sans-serif;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: #0f172a;
}

.log-count {
  font-size: 11px;
  color: #64748b;
  background: #e2e8f0;
  padding: 2px 6px;
  border-radius: 999px;
  font-family: "IBM Plex Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.log-live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: #0f766e;
  background: #ccfbf1;
  border: 1px solid #99f6e4;
  border-radius: 999px;
  padding: 2px 6px;
  letter-spacing: 0.6px;
}

.log-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #14b8a6;
  box-shadow: 0 0 0 0 rgba(20, 184, 166, 0.35);
  animation: log-pulse 1.4s ease-out infinite;
}

@keyframes log-pulse {
  0% { box-shadow: 0 0 0 0 rgba(20, 184, 166, 0.35); }
  70% { box-shadow: 0 0 0 8px rgba(20, 184, 166, 0); }
  100% { box-shadow: 0 0 0 0 rgba(20, 184, 166, 0); }
}

.log-filter {
  width: 220px;
}

.log-timeline {
  padding: 6px 4px 2px;
}

.log-item {
  background: #ffffff;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 10px 18px rgba(15, 23, 42, 0.04);
}

.log-item-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
}

.log-event {
  font-weight: 700;
  color: #0f172a;
  font-family: "Space Grotesk", "IBM Plex Sans", "Helvetica Neue", sans-serif;
}

.log-event-key {
  font-size: 11px;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  padding: 2px 6px;
  border-radius: 6px;
  font-family: "IBM Plex Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.log-item-body {
  margin-top: 6px;
}

.log-json {
  margin: 8px 0 0;
  padding: 8px 10px;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  border: 1px dashed #e2e8f0;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.4;
  color: #0f172a;
  font-family: "IBM Plex Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  white-space: pre-wrap;
}
</style>
