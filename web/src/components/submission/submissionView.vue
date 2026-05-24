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
      <el-table-column prop="judgeResult" label="评测状态" min-width="16%">
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
      <el-table-column prop="codeLength" label="语言 / 代码长度" min-width="15%">
        <template #default="scope">
          <span v-if="scope.row.lang == null">答案 / {{ scope.row.codeLength }} B</span>
          <span v-else>{{ $store.state.langList[scope.row.lang].des }} / {{ scope.row.codeLength }} B </span>
        </template>
      </el-table-column>
      <el-table-column prop="submitTime" label="提交时间" min-width="16%" />
      <el-table-column prop="machine" label="评测机" min-width="10%" />
    </el-table>
  </el-row>
  <el-row style="text-align: center; margin: 0 auto; max-width: 1250px; min-width: 600px;">
    <el-col :span="24" style="min-width: 400px;margin: 0 auto;">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class=" card-header">
            <span>{{ isAnswerSubmission ? '答案文件' : '代码' }}</span>
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
        <monacoEditor v-if="hasTaken && !isAnswerSubmission" :value="code"  :language="$store.state.langList[submissionInfo.lang].lang" @update:value="code = $event" :readOnly="true" />
        <div v-else-if="hasTaken && isAnswerSubmission" class="answer-files">
          <el-collapse v-if="answerFiles.length" v-model="openAnswerFiles" @change="onAnswerFilesOpen">
            <el-collapse-item v-for="f in answerFiles" :key="f.caseId" :name="f.caseId"
              :title="`测试点 #${f.caseId}` + (f.loaded ? ` (${f.size} B${f.truncated ? ', 已截断' : ''}${f.missing ? ', 缺失' : ''})` : '')">
              <pre class="answer-content">{{ f.loaded ? (f.missing ? '(此测试点未提交答案)' : f.content) : '加载中...' }}</pre>
            </el-collapse-item>
          </el-collapse>
          <div v-else class="answer-empty">该提交未关联任何答案文件</div>
        </div>
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
          v-if="!isErrorReport && !submissionInfo.done"
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
          v-if="!isErrorReport && submissionInfo.subtaskInfo"
          :subtaskInfo="submissionInfo.subtaskInfo" />
        <v-md-preview
          v-show="isErrorReport"
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
              <span class="log-title-text">评测日志</span>
              <span v-if="isLive" class="log-live"><span class="log-live-dot" />LIVE</span>
              <span class="log-count">{{ groupedLogEntries.length }} 组 · {{ logEntries.length }} 条</span>
            </div>
            <div class="log-tools">
              <el-radio-group v-model="logCategoryFilter" size="small" class="log-cats">
                <el-radio-button value="all">全部</el-radio-button>
                <el-radio-button value="case">测试点</el-radio-button>
                <el-radio-button value="compile">编译</el-radio-button>
                <el-radio-button value="error">错误</el-radio-button>
              </el-radio-group>
              <el-input v-model="logFilter" size="small" clearable placeholder="搜索" class="log-filter" />
              <el-button size="small" link @click="expandAllGroups">展开</el-button>
              <el-button size="small" link @click="collapseAllGroups">折叠</el-button>
            </div>
          </div>
        </template>
        <div v-if="submissionInfo.judgeLogRestricted" class="log-empty">比赛进行中，评测日志暂不可见。</div>
        <div v-else-if="!logEntries.length" class="log-empty">暂无评测日志</div>
        <div v-else-if="!groupedLogEntries.length" class="log-empty">当前过滤条件下没有日志</div>
        <el-timeline v-else class="log-timeline">
          <el-timeline-item
            v-for="g in groupedLogEntries"
            :key="g.key"
            :type="g.type"
            :timestamp="formatLogTime(g.ts)"
            :hollow="!isGroupOpen(g)"
          >
            <div class="log-group" :class="{ 'is-open': isGroupOpen(g) }">
              <div class="log-group-head" @click="toggleGroup(g)" role="button" tabindex="0" @keydown.enter.prevent="toggleGroup(g)" @keydown.space.prevent="toggleGroup(g)">
                <span class="log-group-arrow" :class="{ 'is-open': isGroupOpen(g) }">▸</span>
                <span class="log-group-label">{{ g.label }}</span>
                <span class="log-group-key">{{ g.keyLabel }}</span>
                <span v-if="g.summary" class="log-group-summary" :class="g.summaryClass">{{ g.summary }}</span>
                <span v-if="g.kind === 'case' && g.entries.length > 1" class="log-group-count">{{ g.entries.length }} 条</span>
              </div>
              <transition name="log-slide">
                <div v-show="isGroupOpen(g)" class="log-group-body" :class="{ 'is-single': g.kind === 'single' }">
                  <template v-if="g.kind === 'single'">
                    <pre v-if="g.entries[0].meta" class="log-json">{{ formatLogPayload(g.entries[0].meta) }}</pre>
                    <pre v-if="g.entries[0].data" class="log-json">{{ formatLogPayload(g.entries[0].data) }}</pre>
                    <div v-if="!g.entries[0].meta && !g.entries[0].data" class="log-empty-body">(无附加数据)</div>
                  </template>
                  <template v-else>
                    <div v-for="(e, i) in g.entries" :key="i" class="log-sub" :class="logItemTypeClass(e.event)">
                      <div class="log-sub-head">
                        <span class="log-sub-dot" />
                        <span class="log-sub-event">{{ logEventLabel(e.event) }}</span>
                        <span class="log-sub-key">{{ e.event }}</span>
                        <span class="log-sub-time">{{ formatLogTime(e.ts) }}</span>
                      </div>
                      <div v-if="entrySubSummary(e)" class="log-sub-summary">{{ entrySubSummary(e) }}</div>
                      <pre v-if="e.meta" class="log-json">{{ formatLogPayload(e.meta) }}</pre>
                      <pre v-if="e.data" class="log-json">{{ formatLogPayload(e.data) }}</pre>
                    </div>
                  </template>
                </div>
              </transition>
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
      logCategoryFilter: 'all',
      // Per-group expansion state, keyed by stable group.key. Survives recompute
      // across SSE refreshes because the key derives from caseId / event+ts.
      expandedGroups: new Set(),
      // answer-submission state
      answerFiles: [],
      openAnswerFiles: [],
      answerLoading: new Set(),
    }
  },
  computed: {
    isLive() {
      return LIVE_STATES.has(this.submissionInfo.judgeResult);
    },
    // Results that have no per-case table — the body is a plain message stored
    // in compileResult. Judgement Failed (bad data / broken SPJ) joins the
    // compile-error and system-error cases here.
    isErrorReport() {
      const r = this.submissionInfo.judgeResult;
      return r === 'Compilation Error' || r === 'System Error' || r === 'Judgement Failed';
    },
    isAnswerSubmission() {
      // submission.lang is NULL only for answer-submission problems
      // (type ∈ {2,3}). Server preserves null through the JSON payload.
      return this.hasTaken && this.submissionInfo.lang == null;
    },
    caseCount() {
      const list = this.submissionInfo.singleCaseResult;
      return Array.isArray(list) ? list.length : 0;
    },
    logEntries() {
      return Array.isArray(this.submissionInfo.judgeLog) ? this.submissionInfo.judgeLog : [];
    },
    filteredLogEntries() {
      const cat = this.logCategoryFilter;
      const q = this.logFilter.trim().toLowerCase();
      return this.logEntries.filter((e) => {
        if (cat !== 'all' && !this.matchesCategory(e, cat)) return false;
        if (!q) return true;
        // Match against raw JSON + the rendered label so "答案错误" / "通过" /
        // "测试点开始" work in addition to "wa" / "caseId".
        const hay = [
          JSON.stringify(e),
          this.logEventLabel(e.event),
          this.entrySubSummary(e),
        ].join(' ').toLowerCase();
        return hay.includes(q);
      });
    },
    // Builds a packed timeline of groups. Test-case events sharing a caseId
    // collapse into a single group whose body lists the sub-events; everything
    // else is a single-entry group. Each group has a stable `key` (caseId or
    // event#ts) so expansion state survives SSE refreshes.
    groupedLogEntries() {
      const out = [];
      const caseGroupByCid = new Map();
      for (const e of this.filteredLogEntries) {
        const ev = e.event || '';
        const caseId = this.entryCaseId(e);
        if (caseId != null && /^case\./.test(ev)) {
          let g = caseGroupByCid.get(caseId);
          if (!g) {
            g = {
              kind: 'case',
              caseId,
              key: 'case#' + caseId,
              label: '测试点 #' + caseId,
              keyLabel: 'case#' + caseId,
              type: 'warning',
              entries: [],
            };
            caseGroupByCid.set(caseId, g);
            out.push(g);
          }
          g.entries.push(e);
          continue;
        }
        // Non-case event → its own group.
        out.push({
          kind: 'single',
          key: ev + '#' + (e.ts || out.length),
          label: this.logEventLabel(ev),
          keyLabel: ev || '-',
          type: this.logItemType(ev),
          entries: [e],
        });
      }
      // Finalize: per-group summary line shown in the collapsed header.
      for (const g of out) {
        if (g.kind === 'case') {
          const compare = g.entries.find((x) => x.event === 'case.compare');
          const run = g.entries.find((x) => x.event === 'case.run');
          const err = g.entries.find((x) => x.event === 'case.error');
          const parts = [];
          if (run && run.data && run.data.time != null) {
            parts.push(Math.max(1, Math.floor((run.data.time || 0) / 1e6)) + ' ms');
          }
          if (run && run.data && run.data.memory != null) {
            parts.push(Math.max(1, Math.floor((run.data.memory || 0) / 1024)) + ' KB');
          }
          if (err) {
            parts.push('错误');
            g.type = 'danger';
            g.summaryClass = 'is-bad';
          } else if (compare && compare.data) {
            const result = compare.data.result;
            if (result === 'partial') {
              const pct = Math.round((compare.data.ratio || 0) * 100);
              parts.push(`部分正确${pct ? ' ' + pct + '%' : ''}`);
              g.type = 'warning';
              g.summaryClass = 'is-partial';
            } else {
              const ok = result === 'ok';
              parts.push(ok ? '通过' : '答案错误');
              g.type = ok ? 'success' : 'danger';
              g.summaryClass = ok ? 'is-ok' : 'is-bad';
            }
          }
          g.summary = parts.join(' · ');
          g.ts = g.entries[0] && g.entries[0].ts;
        } else {
          const e = g.entries[0];
          g.summary = this.entrySummary(e);
          g.summaryClass = '';
          g.ts = e && e.ts;
        }
      }
      return out;
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
    logItemTypeClass(event) {
      const t = this.logItemType(event);
      return 'is-' + t;
    },
    entryCaseId(e) {
      if (!e) return null;
      const d = e.data || e.meta || {};
      return Number.isFinite(d.caseId) ? d.caseId : null;
    },
    matchesCategory(e, cat) {
      const ev = e.event || '';
      if (cat === 'case') return /^case\./.test(ev);
      if (cat === 'compile') return /compile/.test(ev);
      if (cat === 'error') return /error/i.test(ev) || ev === 'error';
      return true;
    },
    // Compact, single-line summary shown in the collapsed header of single-
    // entry groups. Kept under ~80 chars so it doesn't wrap the row.
    entrySummary(e) {
      if (!e) return '';
      const d = e.data || e.meta || {};
      const ev = e.event || '';
      const clip = (s, n) => {
        if (s == null) return '';
        const t = String(s);
        return t.length > n ? t.slice(0, n) + '…' : t;
      };
      if (ev === 'start') {
        const bits = [];
        if (d.pid != null) bits.push('pid=' + d.pid);
        if (d.langName) bits.push(d.langName);
        if (d.timeLimit) bits.push(d.timeLimit + ' ms');
        if (d.memoryLimit) bits.push(d.memoryLimit + ' MB');
        if (d.mode && d.mode !== d.langName) bits.push(d.mode);
        return bits.join(' · ');
      }
      if (ev === 'compile.start' || ev === 'spj.compile.start') {
        return Array.isArray(d.args) ? clip(d.args.join(' '), 90) : '';
      }
      if (ev === 'compile.result' || ev === 'spj.compile.result') {
        const bits = [];
        if (d.exitStatus != null) bits.push('exit=' + d.exitStatus);
        if (d.time != null) bits.push(Math.max(1, Math.floor(d.time / 1e6)) + ' ms');
        if (d.memory != null) bits.push(Math.max(1, Math.floor(d.memory / 1024)) + ' KB');
        return bits.join(' · ');
      }
      if (ev === 'compile.error' || ev === 'spj.compile.error' || ev === 'spj.run.error' || ev === 'error') {
        const msg = d.message || (d.error && d.error.message) || '';
        return clip(msg, 90);
      }
      if (ev === 'finish') {
        const bits = [];
        if (d.totalScore != null) bits.push(d.totalScore + ' 分');
        if (d.totalTime != null) bits.push(d.totalTime + ' ms');
        if (d.maxMemory != null) bits.push(d.maxMemory + ' KB');
        return bits.join(' · ');
      }
      return '';
    },
    // Sub-entry summary (shown inside an expanded case group, above the JSON
    // payload). Mostly mirrors entrySummary, but for case.* events.
    entrySubSummary(e) {
      const ev = e.event || '';
      const d = e.data || e.meta || {};
      const clip = (s, n) => {
        if (s == null) return '';
        const t = String(s);
        return t.length > n ? t.slice(0, n) + '…' : t;
      };
      if (ev === 'case.start') return d.input ? '输入: ' + clip(d.input.replace(/\n+/g, ' '), 100) : '';
      if (ev === 'case.run') {
        const bits = [];
        if (d.status) bits.push(d.status);
        if (d.time != null) bits.push(Math.max(1, Math.floor(d.time / 1e6)) + ' ms');
        if (d.memory != null) bits.push(Math.max(1, Math.floor(d.memory / 1024)) + ' KB');
        if (d.exitStatus != null) bits.push('exit=' + d.exitStatus);
        return bits.join(' · ');
      }
      if (ev === 'case.compare') {
        const r = d.result === 'ok' ? '通过' : '答案错误';
        const detail = d.detail ? ' · ' + clip(d.detail.replace(/\n+/g, ' '), 80) : '';
        return r + detail;
      }
      if (ev === 'case.error') return clip((d.error && d.error.message) || d.message || '', 100);
      return this.entrySummary(e);
    },
    isGroupOpen(g) {
      return this.expandedGroups.has(g.key);
    },
    toggleGroup(g) {
      if (this.expandedGroups.has(g.key)) this.expandedGroups.delete(g.key);
      else this.expandedGroups.add(g.key);
      this.expandedGroups = new Set(this.expandedGroups);
    },
    expandAllGroups() {
      this.expandedGroups = new Set(this.groupedLogEntries.map((g) => g.key));
    },
    collapseAllGroups() {
      this.expandedGroups = new Set();
    },
    rebuildAnswerFiles(info) {
      if (info.lang != null) {
        this.answerFiles = [];
        return;
      }
      // Collect case IDs from whichever data shape is currently populated.
      // singleCaseResult is the streaming list while judging; subtaskInfo is
      // the post-aggregation shape. Some cases can appear in both during the
      // transition; dedupe by caseId.
      const seen = new Map();
      const push = (caseId) => {
        if (!Number.isFinite(caseId)) return;
        if (!seen.has(caseId)) seen.set(caseId, { caseId, loaded: false, missing: false, content: '', size: null, truncated: false });
      };
      if (Array.isArray(info.singleCaseResult)) {
        for (const c of info.singleCaseResult) push(c.caseId);
      }
      if (info.subtaskInfo) {
        for (const sid of Object.keys(info.subtaskInfo)) {
          const cs = info.subtaskInfo[sid].cases || [];
          for (const c of cs) push(c.caseId);
        }
      }
      const next = Array.from(seen.values()).sort((a, b) => a.caseId - b.caseId);
      // Preserve loaded content across re-renders.
      const prev = new Map(this.answerFiles.map((f) => [f.caseId, f]));
      for (const f of next) {
        const old = prev.get(f.caseId);
        if (old && old.loaded) Object.assign(f, old);
      }
      this.answerFiles = next;
    },
    async loadAnswerFile(caseId) {
      if (this.answerLoading.has(caseId)) return;
      this.answerLoading.add(caseId);
      try {
        const res = await axios.post('/api/judge/getAnswerFile', { sid: this.sid, caseId });
        if (res.status === 200 && res.data) {
          const idx = this.answerFiles.findIndex((f) => f.caseId === caseId);
          if (idx >= 0) {
            const f = this.answerFiles[idx];
            f.loaded = true;
            f.content = res.data.content || '';
            f.size = res.data.size != null ? res.data.size : 0;
            f.truncated = !!res.data.truncated;
            f.missing = !!res.data.missing;
            this.answerFiles = [...this.answerFiles];
          }
        }
      } catch (err) {
        this.$message.error('加载答案失败');
      } finally {
        this.answerLoading.delete(caseId);
      }
    },
    onAnswerFilesOpen(activeNames) {
      const list = Array.isArray(activeNames) ? activeNames : [activeNames];
      for (const cid of list) {
        const f = this.answerFiles.find((x) => x.caseId === cid);
        if (f && !f.loaded) this.loadAnswerFile(cid);
      }
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
      this.rebuildAnswerFiles(info);
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
  text-align: center;
}

.log-card :deep(.el-card__header) {
  background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%);
  border-bottom: 1px solid #e2e8f0;
  padding: 12px 16px;
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
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

.log-title-text {
  font-size: 14px;
}

.log-count {
  font-size: 11px;
  color: #64748b;
  background: #e2e8f0;
  padding: 2px 8px;
  border-radius: 999px;
  font-family: "IBM Plex Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  letter-spacing: 0.2px;
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
  padding: 2px 7px;
  letter-spacing: 0.6px;
  font-weight: 700;
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

.log-tools {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.log-cats :deep(.el-radio-button__inner) {
  font-size: 12px;
  padding: 6px 10px;
}

.log-filter {
  width: 180px;
}

.log-timeline {
  padding: 12px 4px 2px;
}

/* Tighter timeline rail — default is too generous for a compact view. */
.log-timeline :deep(.el-timeline-item) {
  padding-bottom: 12px;
}

.log-timeline :deep(.el-timeline-item__timestamp.is-top) {
  margin-bottom: 4px;
  font-size: 11px;
  color: #94a3b8;
  font-family: "IBM Plex Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.log-group {
  background: #ffffff;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  box-shadow: 0 6px 14px rgba(15, 23, 42, 0.04);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.log-group:hover {
  border-color: #c7d2fe;
  box-shadow: 0 10px 22px rgba(79, 70, 229, 0.08);
}

.log-group.is-open {
  border-color: #c7d2fe;
  background: linear-gradient(180deg, #ffffff 0%, #fafbff 100%);
  box-shadow: 0 14px 28px rgba(79, 70, 229, 0.10);
}

.log-group-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  outline: none;
}

.log-group-head:focus-visible {
  box-shadow: inset 0 0 0 2px rgba(79, 70, 229, 0.35);
  border-radius: 10px;
}

.log-group-arrow {
  color: #94a3b8;
  font-size: 12px;
  width: 12px;
  display: inline-block;
  transition: transform 0.2s ease;
}

.log-group-arrow.is-open {
  transform: rotate(90deg);
  color: #4f46e5;
}

.log-group-label {
  font-weight: 700;
  color: #0f172a;
  font-family: "Space Grotesk", "IBM Plex Sans", "Helvetica Neue", sans-serif;
  font-size: 13px;
}

.log-group-key {
  font-size: 11px;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  padding: 1px 7px;
  border-radius: 6px;
  font-family: "IBM Plex Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  letter-spacing: 0.2px;
}

.log-group-summary {
  margin-left: auto;
  font-size: 12px;
  color: #475569;
  font-family: "IBM Plex Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60%;
}

.log-group-summary.is-ok {
  color: #15803d;
  font-weight: 600;
}

.log-group-summary.is-bad {
  color: #b91c1c;
  font-weight: 600;
}

.log-group-summary.is-partial {
  color: #0c8043;
  font-weight: 600;
}

.log-group-count {
  font-size: 10px;
  color: #6366f1;
  background: #eef2ff;
  border: 1px solid #c7d2fe;
  padding: 1px 6px;
  border-radius: 999px;
  font-weight: 600;
}

.log-group-body {
  padding: 0 14px 12px;
  border-top: 1px dashed #e2e8f0;
  margin-top: 0;
  display: grid;
  gap: 8px;
}

.log-group-body > .log-sub:first-child {
  margin-top: 10px;
}

.log-group-body.is-single {
  padding-top: 10px;
}

.log-empty-body {
  padding: 8px 10px;
  color: #94a3b8;
  font-size: 12px;
  font-family: "IBM Plex Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.log-sub {
  padding: 8px 10px;
  border: 1px solid #eef2f7;
  border-radius: 8px;
  background: #fafbfd;
}

.log-sub.is-success { border-left: 3px solid #22c55e; }
.log-sub.is-danger  { border-left: 3px solid #ef4444; }
.log-sub.is-warning { border-left: 3px solid #f59e0b; }
.log-sub.is-primary { border-left: 3px solid #6366f1; }
.log-sub.is-info    { border-left: 3px solid #94a3b8; }

.log-sub-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.log-sub-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #cbd5e1;
}

.log-sub.is-success .log-sub-dot { background: #22c55e; }
.log-sub.is-danger  .log-sub-dot { background: #ef4444; }
.log-sub.is-warning .log-sub-dot { background: #f59e0b; }
.log-sub.is-primary .log-sub-dot { background: #6366f1; }

.log-sub-event {
  font-weight: 700;
  font-size: 12px;
  color: #1e293b;
}

.log-sub-key {
  font-size: 10px;
  color: #64748b;
  background: #eef2f7;
  padding: 1px 5px;
  border-radius: 4px;
  font-family: "IBM Plex Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.log-sub-time {
  margin-left: auto;
  font-size: 11px;
  color: #94a3b8;
  font-family: "IBM Plex Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.log-sub-summary {
  margin: 6px 0 0;
  font-size: 12px;
  color: #334155;
  font-family: "IBM Plex Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.log-json {
  margin: 6px 0 0;
  padding: 8px 10px;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  border: 1px dashed #e2e8f0;
  border-radius: 8px;
  font-size: 11.5px;
  line-height: 1.45;
  color: #0f172a;
  font-family: "IBM Plex Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 280px;
  overflow: auto;
}

.log-slide-enter-active,
.log-slide-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.log-slide-enter-from,
.log-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.answer-files {
  padding: 6px 12px 12px;
}

.answer-content {
  margin: 0;
  padding: 10px 12px;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  border: 1px dashed #e2e8f0;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.45;
  color: #0f172a;
  font-family: "IBM Plex Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  white-space: pre-wrap;
  max-height: 360px;
  overflow: auto;
}

.answer-empty {
  padding: 18px;
  color: #909399;
  font-size: 12px;
  text-align: center;
}
</style>
