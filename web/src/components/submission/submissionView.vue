<template>
  <div class="sv-page">
    <el-card class="box-card summary-card" shadow="hover" v-loading="!hasTaken">
      <div v-if="!hasTaken" class="summary-loading"></div>
      <div v-else class="summary-wrap">
        <div class="summary-status">
          <div class="summary-result" :class="{ 'is-live': isLive }"
            :style="{ color: resColor[submissionInfo.judgeResult] || '#909399' }">
            <span v-if="isLive" class="live-dot"></span>
            {{ submissionInfo.judgeResult }}
          </div>
          <div class="summary-score-line">
            <span class="summary-score" :style="{ color: scoreColor[Math.floor((submissionInfo.score || 0) / 10)] }">
              {{ submissionInfo.score }}
            </span>
            <span class="summary-score-unit">分</span>
          </div>
        </div>
        <div class="summary-info">
          <div class="summary-line1">
            <span class="sid-chip">#{{ submissionInfo.sid }}</span>
            <router-link class="rlink summary-title" :to="!isContest ?
              '/problem/' + submissionInfo.pid :
              '/contest/' + submissionInfo.cid + '/problem/' + submissionInfo.idx">
              {{ submissionInfo.title }}
            </router-link>
            <el-icon id="hidden" v-if="!submissionInfo.problemPublic && !isContest">
              <Hide />
            </el-icon>
            <span class="summary-by">by</span>
            <router-link class="rlink" :to="'/user/' + submissionInfo.uid">
              {{ submissionInfo.name }}
            </router-link>
          </div>
          <div class="summary-meta">
            <div class="meta-item">
              <span class="meta-label">总用时</span>
              <span class="meta-value">{{ submissionInfo.time }} ms</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">内存</span>
              <span class="meta-value">{{ submissionInfo.memory }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">语言 / 代码长度</span>
              <span class="meta-value">{{ langText }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">提交时间</span>
              <span class="meta-value">{{ submissionInfo.submitTime }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">评测机</span>
              <span class="meta-value">{{ submissionInfo.machine || '-' }}</span>
            </div>
          </div>
        </div>
      </div>
    </el-card>
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class=" card-header">
            <span class="code-title">
              {{ isAnswerSubmission ? '答案文件' : '代码' }}
              <el-tag v-if="hasTaken && !isContest" :type="submissionInfo.isPublic ? 'success' : 'danger'" size="small">
                {{ submissionInfo.isPublic ? '公开提交' : '私有提交' }}
              </el-tag>
            </span>
            <el-button-group>
              <el-button v-if="submissionInfo.canDownload" type="primary" @click="downloadSubmissionFile">
                <el-icon class="el-icon--left">
                  <Download />
                </el-icon>
                下载
              </el-button>
              <el-popconfirm
                v-if="submissionInfo.canSetPublic"
                confirm-button-text="确认"
                cancel-button-text="取消"
                :title="submissionInfo.isPublic ? '确认设为私有提交?' : '确认公开提交?'"
                @confirm="toggleSubmissionPublic"
              >
                <template #reference>
                  <el-button :type="submissionInfo.isPublic ? 'info' : 'success'">
                    <el-icon class="el-icon--left">
                      <Hide v-if="submissionInfo.isPublic" />
                      <View v-else />
                    </el-icon>
                    {{ submissionInfo.isPublic ? '设为私有' : '公开提交' }}
                  </el-button>
                </template>
              </el-popconfirm>
              <el-popconfirm v-if="canRejudge" confirm-button-text="确认" cancel-button-text="取消" title="确认取消评测?"
                @confirm="cancelSubmission">
                <template #reference>
                  <el-button type="warning">
                    <el-icon class="el-icon--left">
                      <CloseBold />
                    </el-icon>
                    取消评测
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
              <el-popconfirm v-if="submissionInfo.canDelete" confirm-button-text="确认" cancel-button-text="取消" title="确认删除提交? 此操作不可撤销。"
                @confirm="deleteSubmission">
                <template #reference>
                  <el-button type="danger">
                    <el-icon class="el-icon--left">
                      <Delete />
                    </el-icon>
                    删除
                  </el-button>
                </template>
              </el-popconfirm>
            </el-button-group>
          </div>
        </template>
        <div v-if="hasTaken && !isAnswerSubmission" class="source-files">
          <monacoEditor
            v-if="!hasMultipleSourceFiles"
            :value="code"
            :language="sourceLanguage(sourceFiles[0])"
            @update:value="code = $event"
            :readOnly="true"
          />
          <el-tabs v-else v-model="sourceActiveName" class="source-tabs">
            <el-tab-pane
              v-for="(file, index) in sourceFiles"
              :key="sourceFileKey(file, index)"
              :label="sourceTabLabel(file, index)"
              :name="sourceFileKey(file, index)"
            >
              <monacoEditor
                :value="file.content || ''"
                :language="sourceLanguage(file)"
                :height="420"
                :readOnly="true"
              />
            </el-tab-pane>
          </el-tabs>
        </div>
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
      <el-card v-if="judgeFlow" class="box-card flow-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <span>评测流程</span>
            <div class="interaction-tags">
              <el-tag size="small" effect="plain">{{ presetLabel(profileSummary.preset) }}</el-tag>
              <el-tag v-if="profileSummary.submitMode === 'answer'" size="small" type="warning" effect="plain">只交答案，不运行代码</el-tag>
            </div>
          </div>
        </template>

        <div class="flow-line">
          <!-- ① 提交 -->
          <div class="flow-stage">
            <div class="flow-stage-title">① 提交</div>
            <div v-if="!judgeFlow.submit.length" class="flow-node">
              <span class="flow-node-main">{{ profileSummary.submitMode === 'answer' ? '各测试点答案文件' : '你的代码' }}</span>
            </div>
            <div v-for="(f, i) in judgeFlow.submit" :key="'sf' + i" class="flow-node">
              <span class="flow-node-main">{{ f.label }}</span>
              <span v-if="f.name" class="flow-node-sub">{{ f.name }}</span>
            </div>
          </div>
          <div class="flow-arrow">→</div>

          <!-- ② 编译 -->
          <template v-if="judgeFlow.compile.length">
            <div class="flow-stage">
              <div class="flow-stage-title">② 编译</div>
              <div v-for="c in judgeFlow.compile" :key="'c' + c.id" class="flow-node node-compile">
                <span class="flow-node-main">{{ c.id }}</span>
                <span class="flow-node-sub">{{ c.auto ? '选手代码 · 按语言自动编译' : ('由 ' + c.inputs.join(' + ') + ' 编译') }}</span>
              </div>
            </div>
            <div class="flow-arrow">→</div>
          </template>

          <!-- ③ 每个测试点 -->
          <div class="flow-stage flow-stage-percase">
            <div class="flow-stage-title">{{ judgeFlow.compile.length ? '③' : '②' }} 每个测试点</div>
            <div class="percase-steps">
              <template v-for="(s, i) in judgeFlow.steps" :key="'st' + i">
                <div class="flow-node" :class="'node-' + s.kind">
                  <template v-if="s.kind === 'exec'">
                    <span class="flow-node-main">▶ 运行 {{ s.exec }}</span>
                    <span class="flow-node-sub">输入：{{ refLabel(s.stdin) }}</span>
                  </template>
                  <template v-else-if="s.kind === 'pipeGroup'">
                    <span class="flow-node-main">⇄ 实时交互</span>
                    <span class="flow-node-sub">{{ pipeGroupDesc(s) }}</span>
                    <span class="flow-node-sub">裁决来自 {{ s.verdictFrom }} · 计时按 {{ chargeTimeLabel(s) }}</span>
                  </template>
                  <template v-else-if="s.kind === 'check'">
                    <span class="flow-node-main">✓ 裁决</span>
                    <span class="flow-node-sub">{{ checkerLabel(s.checker) }}</span>
                  </template>
                  <template v-else>
                    <span class="flow-node-main">{{ s.kind }}</span>
                  </template>
                </div>
                <div v-if="i < judgeFlow.steps.length - 1" class="flow-arrow flow-arrow-small">→</div>
              </template>
            </div>
          </div>
        </div>

        <div v-if="pipeEvents.length" class="flow-pipe-results">
          <div class="flow-pipe-title">各测试点交互结果</div>
          <el-table :data="pipeEvents" :cell-style="{ textAlign: 'center' }" :header-cell-style="{ textAlign: 'center' }">
            <el-table-column prop="caseId" label="测试点" width="100" />
            <el-table-column prop="stepId" label="步骤" width="140" />
            <el-table-column prop="resultName" label="裁决" />
            <el-table-column prop="ratioText" label="得分率" width="110" />
            <el-table-column prop="timeText" label="用时" width="110" />
            <el-table-column prop="memoryText" label="内存" width="110" />
          </el-table>
        </div>
        <div v-else-if="isInteractionSubmission && isLive" class="interaction-empty">交互进行中，测试点结果将实时出现</div>
      </el-card>
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
                <el-radio-button value="pipe">交互</el-radio-button>
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
  </div>
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
      resColor,
      scoreColor,
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
      sourceActiveName: '',
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
    langText() {
      const info = this.submissionInfo;
      if (info.lang == null) return `答案 / ${info.codeLength} B`;
      const l = (this.$store.state.langList || {})[info.lang];
      return `${l ? l.des : '未知'} / ${info.codeLength} B`;
    },
    sourceFiles() {
      const files = Array.isArray(this.submissionInfo.sourceFiles) ? this.submissionInfo.sourceFiles : [];
      if (files.length) return files;
      return [{
        name: 'main',
        label: '代码',
        kind: 'source',
        lang: this.submissionInfo.lang,
        content: this.code || '',
      }];
    },
    hasMultipleSourceFiles() {
      return this.sourceFiles.length > 1;
    },
    caseCount() {
      const list = this.submissionInfo.singleCaseResult;
      return Array.isArray(list) ? list.length : 0;
    },
    logEntries() {
      return Array.isArray(this.submissionInfo.judgeLog) ? this.submissionInfo.judgeLog : [];
    },
    profileSummary() {
      return this.submissionInfo.judgeProfileSummary || null;
    },
    // Pipeline card data. Traditional problems (single auto compile + run +
    // default check) skip the card — their flow is obvious; everything else
    // (SPJ / function / interactive / communication / answer / custom) shows it.
    judgeFlow() {
      const p = this.profileSummary;
      if (!p || !Array.isArray(p.steps) || !p.steps.length) return null;
      if (p.preset === 'traditional') return null;
      return {
        submit: Array.isArray(p.submitFiles) ? p.submitFiles : [],
        compile: (Array.isArray(p.compile) ? p.compile : []).filter((c) => c && c.id),
        steps: p.steps,
      };
    },
    isInteractionSubmission() {
      return !!(this.profileSummary && this.profileSummary.interactive) ||
        this.logEntries.some((e) => /^case\.pipe\./.test(e.event || ''));
    },
    pipeEvents() {
      return this.logEntries
        .filter((e) => e.event === 'case.pipe.result')
        .map((e) => {
          const d = e.data || {};
          return {
            caseId: d.caseId,
            stepId: d.stepId || '-',
            resultName: d.resultName || d.result || '-',
            ratioText: d.ratio == null ? '-' : Math.round(Number(d.ratio) * 100) + '%',
            timeText: d.time == null ? '-' : Math.floor(Number(d.time)) + ' ms',
            memoryText: d.memory == null ? '-' : Math.floor(Number(d.memory)) + ' KB',
          };
        });
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
    presetLabel(preset) {
      return {
        traditional: '传统题',
        spj: 'SPJ',
        function: '提交函数',
        interactive: '交互题',
        communication: '通信题',
        answer: '提交答案',
        'answer-spj': '提交答案 SPJ',
        custom: '自定义',
      }[preset] || preset || '自定义';
    },
    // Human labels for profile Refs shown in the pipeline card.
    refLabel(ref) {
      if (ref == null || ref === '') return '-';
      const fixed = {
        'case.input': '测试点输入',
        'case.answer': '标准答案',
        'submit.answer': '选手提交的答案',
      };
      if (fixed[ref]) return fixed[ref];
      const m = /^step:([A-Za-z0-9_-]+)\.(stdout|stderr)$/.exec(String(ref));
      if (m) return `步骤 ${m[1]} 的${m[2] === 'stdout' ? '输出' : '错误输出'}`;
      if (String(ref).startsWith('asset:')) return String(ref).slice(6);
      return String(ref);
    },
    checkerLabel(checker) {
      if (checker === 'default') return '内置文本对比';
      const s = String(checker || '');
      if (s.startsWith('asset:')) return `${s.slice(6)}（Special Judge）`;
      return s ? `自定义校验程序 ${s}` : '-';
    },
    // "user (main) ⇄ judge (interactor)" — derived from members + pipes.
    pipeGroupDesc(s) {
      const members = (s.members || [])
        .map((m) => (m.exec && m.exec !== m.id ? `${m.id}（${m.exec}）` : m.id));
      return members.join(' ⇄ ');
    },
    chargeTimeLabel(s) {
      const raw = s && s.chargeTimeTo != null ? s.chargeTimeTo : s && s.verdictFrom;
      const list = Array.isArray(raw) ? raw : [raw];
      return list.filter(Boolean).join(' + ') || '-';
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
        'case.pipe.start': '管道组开始',
        'case.pipe.result': '管道组结果',
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
      if (cat === 'pipe') return /^case\.pipe\./.test(ev);
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
        const bits = [];
        if (d.id) bits.push('产物 ' + d.id);
        const command = d.command || d.args;
        if (Array.isArray(command)) bits.push(clip(command.join(' '), 90));
        else if (command === 'auto') bits.push('按语言自动编译');
        return bits.join(' · ');
      }
      if (ev === 'compile.result' || ev === 'spj.compile.result') {
        const bits = [];
        if (d.id) bits.push('产物 ' + d.id);
        if (d.exitCode != null) bits.push('exit=' + d.exitCode);
        const time = d.cpuTimeMs != null ? d.cpuTimeMs : d.time;
        const memory = d.memoryKb != null ? d.memoryKb : d.memory;
        if (time != null) bits.push(Math.max(1, Math.floor(time)) + ' ms');
        if (memory != null) bits.push(Math.max(1, Math.floor(memory)) + ' KB');
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
        const time = d.cpuTimeMs != null ? d.cpuTimeMs : d.time;
        const memory = d.memoryKb != null ? d.memoryKb : d.memory;
        if (time != null) bits.push(Math.max(1, Math.floor(time)) + ' ms');
        if (memory != null) bits.push(Math.max(1, Math.floor(memory)) + ' KB');
        if (d.exitCode != null) bits.push('exit=' + d.exitCode);
        return bits.join(' · ');
      }
      if (ev === 'case.pipe.start') {
        const members = Array.isArray(d.members) ? d.members.join(', ') : '';
        const pipeCount = Array.isArray(d.pipes) ? d.pipes.length : 0;
        return [members, pipeCount ? pipeCount + ' 管道' : '', d.verdictFrom ? '裁决=' + d.verdictFrom : '']
          .filter(Boolean).join(' · ');
      }
      if (ev === 'case.pipe.result') {
        const bits = [];
        if (d.resultName) bits.push(d.resultName);
        if (d.ratio != null) bits.push(Math.round(Number(d.ratio) * 100) + '%');
        if (d.time != null) bits.push(Math.floor(Number(d.time)) + ' ms');
        if (d.memory != null) bits.push(Math.floor(Number(d.memory)) + ' KB');
        return bits.join(' · ');
      }
      if (ev === 'case.compare') {
        const r = d.result === 'ok' ? '通过'
          : d.result === 'partial' ? `部分正确${d.ratio != null ? ' ' + Math.round(Number(d.ratio) * 100) + '%' : ''}`
            : '答案错误';
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
    sourceFileKey(file, index) {
      return `${file && file.name ? file.name : 'source'}-${index}`;
    },
    sourceTabLabel(file, index) {
      const name = file && (file.label || file.name);
      const size = file && file.content ? ` · ${file.content.length} B` : '';
      return `${name || ('文件 ' + (index + 1))}${size}`;
    },
    sourceLanguage(file) {
      const langId = file && file.lang != null ? file.lang : this.submissionInfo.lang;
      const row = (this.$store.state.langList || {})[langId];
      return (row && row.lang) || 'cpp';
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
      const sourceFiles = Array.isArray(info.sourceFiles) ? info.sourceFiles : [];
      if (sourceFiles.length) {
        this.code = sourceFiles[0].content || this.code;
        const firstKey = this.sourceFileKey(sourceFiles[0], 0);
        if (!this.sourceActiveName || !sourceFiles.some((file, index) => this.sourceFileKey(file, index) === this.sourceActiveName)) {
          this.sourceActiveName = firstKey;
        }
      }
      this.hasTaken = true;
      this.canRejudge = !!info.canRejudge;
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
        if (res.status === 200 && res.data && res.data.skipped) this.$message.info('提交已结束，无需取消');
        else if (res.status === 200) this.$message.success('取消成功');
        else this.$message.error('取消失败');
      });
    },
    downloadBase64File(payload) {
      const raw = atob(payload.content || '');
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const blob = new Blob([bytes], { type: payload.mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = payload.filename || ('submission-' + this.sid + '.txt');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    downloadSubmissionFile() {
      axios.post('/api/judge/downloadSubmissionFile', { sid: this.sid }).then(res => {
        if (res.status === 200 && res.data) {
          this.downloadBase64File(res.data);
        } else {
          this.$message.error((res.data && res.data.message) || '下载失败');
        }
      }).catch(err => {
        const msg = err && err.response && err.response.data && err.response.data.message;
        this.$message.error(msg || err.message || '下载失败');
      });
    },
    toggleSubmissionPublic() {
      const next = !this.submissionInfo.isPublic;
      axios.post('/api/judge/setSubmissionPublic', { sid: this.sid, isPublic: next }).then(res => {
        if (res.status === 200) {
          this.$message.success(next ? '提交已公开' : '提交已设为私有');
          this.submissionInfo.isPublic = next ? 1 : 0;
        } else {
          this.$message.error((res.data && res.data.message) || '设置失败');
        }
      }).catch(err => {
        const msg = err && err.response && err.response.data && err.response.data.message;
        this.$message.error(msg || err.message || '设置失败');
      });
    },
    deleteSubmission() {
      axios.post('/api/judge/deleteSubmission', { sid: this.sid }).then(res => {
        if (res.status === 200) {
          this.$message.success('提交已删除');
          this.closeStream();
          this.$router.push('/submission');
        } else {
          this.$message.error((res.data && res.data.message) || '删除失败');
        }
      }).catch(err => {
        const msg = err && err.response && err.response.data && err.response.data.message;
        this.$message.error(msg || err.message || '删除失败');
      });
    },
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
.sv-page {
  max-width: 1250px;
  margin: 0 auto;
}

.box-card {
  margin: 10px;
  text-align: left;
  border-radius: 10px;
}

/* ---- 顶部概要卡片 ---- */
.summary-loading {
  height: 96px;
}

.summary-wrap {
  display: flex;
  align-items: center;
  gap: 24px;
}

.summary-status {
  flex: 0 0 auto;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px 18px 4px 6px;
  border-right: 1px solid #f0f2f5;
}

.summary-result {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 0.2px;
  text-align: center;
  line-height: 1.25;
}

.summary-score-line {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}

.summary-score {
  font-size: 28px;
  font-weight: 800;
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.summary-score-unit {
  font-size: 12px;
  color: #909399;
}

.summary-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.summary-line1 {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.sid-chip {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 1px 8px;
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.summary-title {
  font-size: 16px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}

.summary-by {
  color: #c0c4cc;
  font-size: 12px;
}

.summary-meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px 18px;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.meta-label {
  font-size: 11px;
  color: #94a3b8;
  letter-spacing: 0.4px;
}

.meta-value {
  font-size: 13px;
  font-weight: 600;
  color: #334155;
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 768px) {
  .summary-wrap {
    flex-direction: column;
    align-items: stretch;
    gap: 14px;
  }

  .summary-status {
    flex-direction: row;
    justify-content: center;
    align-items: baseline;
    gap: 16px;
    padding: 0 0 10px;
    border-right: none;
    border-bottom: 1px solid #f0f2f5;
    min-width: 0;
  }

  .summary-title {
    max-width: 100%;
  }
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  flex-wrap: wrap;
}

.code-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.sub {
  padding: 15px;
  border-style: solid;
  border-radius: 5px;
}

.summary-result.is-live {
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

.interaction-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.interaction-empty {
  color: #909399;
  text-align: center;
  padding: 18px 0;
}

/* ---- 评测流程 pipeline ---- */
.flow-line {
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 4px 2px 8px;
  overflow-x: auto;
}

.flow-stage {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  min-width: 150px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: linear-gradient(180deg, #fbfdff 0%, #f5f8fc 100%);
}

.flow-stage-percase {
  flex: 1;
  min-width: 320px;
}

.flow-stage-title {
  font-size: 12px;
  font-weight: 700;
  color: #475569;
  letter-spacing: 0.4px;
  margin-bottom: 2px;
}

.percase-steps {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.flow-node {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  text-align: left;
}

.flow-node-main {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}

.flow-node-sub {
  font-size: 11.5px;
  color: #64748b;
  font-family: "IBM Plex Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.flow-node.node-exec { border-left: 3px solid #409eff; }
.flow-node.node-check { border-left: 3px solid #67c23a; }
.flow-node.node-pipeGroup { border-left: 3px solid #e6a23c; }
.flow-node.node-compile { border-left: 3px solid #909399; }

.flow-arrow {
  align-self: center;
  color: #94a3b8;
  font-weight: 700;
  font-size: 16px;
  flex: 0 0 auto;
}

.flow-arrow-small {
  font-size: 13px;
}

.flow-pipe-results {
  margin-top: 6px;
  border-top: 1px dashed #e2e8f0;
  padding-top: 10px;
}

.flow-pipe-title {
  text-align: left;
  font-size: 13px;
  font-weight: 700;
  color: #475569;
  margin-bottom: 6px;
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

.source-files {
  padding: 0 12px 12px;
}

.source-tabs :deep(.el-tabs__header) {
  margin-bottom: 10px;
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

@media (max-width: 768px) {
  .box-card {
    margin: 0 0 10px;
  }

  .summary-result {
    font-size: 18px;
  }

  .summary-score {
    font-size: 22px;
  }

  .flow-stage-percase {
    min-width: 260px;
  }

  .log-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .log-tools,
  .log-filter {
    width: 100%;
  }

  .log-cats {
    max-width: 100%;
    overflow-x: auto;
  }

  .log-group-head {
    flex-wrap: wrap;
    padding: 10px;
  }

  .log-group-summary {
    flex-basis: calc(100% - 30px);
    margin-left: 30px;
    max-width: none;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .log-sub-time {
    width: 100%;
    margin-left: 14px;
  }

  .log-timeline {
    padding-inline: 0;
  }

  .log-timeline :deep(.el-timeline-item__wrapper) {
    padding-left: 18px;
  }

  .source-files,
  .answer-files {
    padding-inline: 0;
  }
}
</style>
