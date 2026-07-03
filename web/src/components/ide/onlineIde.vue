<template>
  <div class="ide-page">
    <div class="ide-shell">
      <header class="ide-topbar">
        <div class="ide-title-block">
          <div class="eyebrow">WORKSPACE</div>
          <h1>在线 IDE</h1>
        </div>
        <div class="ide-actions">
          <el-radio-group v-model="mode" size="small" @change="onModeChange">
            <el-radio-button label="free">自由</el-radio-button>
            <el-radio-button label="problem">题目</el-radio-button>
          </el-radio-group>
          <template v-if="mode === 'problem'">
            <el-select
              v-model="pidInput"
              class="ide-problem-select"
              size="small"
              filterable
              remote
              reserve-keyword
              clearable
              allow-create
              default-first-option
              :remote-method="searchProblems"
              :loading="problemSearchLoading"
              placeholder="搜索 PID 或题目标题"
              @change="onProblemSelect">
              <el-option
                v-for="item in problemOptions"
                :key="item.pid"
                :label="problemOptionLabel(item)"
                :value="String(item.pid)" />
            </el-select>
            <el-button size="small" :loading="profileLoading" @click="loadProblem">
              <el-icon class="el-icon--left"><Search /></el-icon>载入
            </el-button>
          </template>
          <el-select v-model="lang" placeholder="语言" size="default" class="ide-lang" @change="onLangChange">
            <el-option v-for="l in availableLangOptions" :key="l.id" :label="l.des" :value="l.id" />
          </el-select>
          <el-button type="primary" :loading="runLoading" :disabled="runDisabled" @click="startRun">
            <el-icon class="el-icon--left"><VideoPlay /></el-icon>运行
          </el-button>
          <el-button type="danger" plain :disabled="mode !== 'free' || !isLive" @click="stop">
            <el-icon class="el-icon--left"><Close /></el-icon>停止
          </el-button>
        </div>
      </header>

      <div v-if="mode === 'problem' && problemCtx" class="problem-strip">
        <div class="problem-title">#{{ problemCtx.pid }} {{ problemCtx.title }}</div>
        <div class="problem-tags">
          <el-tag size="small" effect="plain">{{ problemCtx.summary && problemCtx.summary.label }}</el-tag>
          <el-tag size="small" effect="plain" type="info">{{ problemCtx.summary && problemCtx.summary.compare }}</el-tag>
          <el-tag v-if="!problemCtx.runnable" size="small" type="warning" effect="plain">不可运行</el-tag>
        </div>
      </div>

      <div class="ide-grid">
        <section class="ide-panel editor-panel">
          <div class="panel-head">
            <div class="panel-title">编辑器</div>
            <div class="panel-meta">
              <span v-if="mode === 'problem'">{{ submitSlots.length || 0 }} 个文件</span>
              <span v-else>{{ editorLang }}</span>
            </div>
          </div>

          <template v-if="mode === 'problem'">
            <el-empty v-if="!problemCtx" :image-size="78" description="未载入题目" />
            <template v-else>
              <el-tabs v-model="activeSlot" class="slot-tabs">
                <el-tab-pane
                  v-for="(slot, i) in submitSlots"
                  :key="slotKey(slot, i)"
                  :label="slotTabLabel(slot, i)"
                  :name="String(i)">
                  <div class="slot-head">
                    <span>{{ slot.label || ('文件 ' + (i + 1)) }}</span>
                    <code v-if="slot.name">{{ slot.name }}</code>
                    <el-tag v-if="slot.primary" size="small" effect="plain">主文件</el-tag>
                    <el-tag v-if="slot.optional" size="small" type="info" effect="plain">可选</el-tag>
                  </div>
                  <div class="editor-frame">
                    <monacoEditor
                      v-if="slot.kind === 'source'"
                      :value="multiCode[i] || ''"
                      :language="editorLangForSlot(slot)"
                      :height="slotEditorHeight"
                      @update:value="setMultiContent(i, $event)" />
                    <el-input
                      v-else
                      type="textarea"
                      :rows="18"
                      resize="vertical"
                      :model-value="multiCode[i] || ''"
                      @input="setMultiContent(i, $event)" />
                  </div>
                </el-tab-pane>
              </el-tabs>
            </template>
          </template>

          <div v-else class="editor-frame">
            <monacoEditor
              :value="code"
              :language="editorLang"
              :height="editorHeight"
              @update:value="code = $event" />
          </div>
        </section>

        <section class="ide-panel terminal-panel">
          <div class="panel-head">
            <div class="panel-title terminal-title">
              终端
              <el-tag size="small" :type="statusTag.type" effect="light" round>{{ statusTag.text }}</el-tag>
            </div>
            <el-button text size="small" @click="clearTerminal">
              <el-icon class="el-icon--left"><Delete /></el-icon>清空
            </el-button>
          </div>

          <div ref="termEl" class="ide-term"></div>
          <div class="ide-meta" v-if="exitInfo">
            <span class="ide-meta-badge" :class="exitInfo.ok ? 'ok' : 'bad'">{{ exitInfo.label }}</span>
            <span v-if="exitInfo.detail" class="ide-meta-detail">{{ exitInfo.detail }}</span>
          </div>

          <div class="input-panel" v-if="mode === 'free'">
            <div class="input-title">stdin</div>
            <el-input
              type="textarea"
              v-model="stdinBox"
              :rows="5"
              resize="vertical"
              placeholder="发送到 stdin" />
            <div class="ide-input-actions">
              <el-button size="small" type="primary" plain :disabled="!isRunning" @click="sendStdinBox">
                <el-icon class="el-icon--left"><Promotion /></el-icon>发送
              </el-button>
              <el-button size="small" :disabled="!isRunning" @click="sendEof">发送 EOF</el-button>
            </div>
          </div>

          <div class="input-panel" v-else>
            <div class="input-title">输入</div>
            <div v-if="problemCtx && problemCtx.samples && problemCtx.samples.length" class="sample-row">
              <el-select v-model="sampleIndex" size="small" class="sample-select" placeholder="样例">
                <el-option
                  v-for="(sample, i) in problemCtx.samples"
                  :key="i"
                  :label="'样例 #' + (i + 1)"
                  :value="i" />
              </el-select>
              <el-button size="small" plain @click="useSelectedSample">使用样例</el-button>
            </div>
            <el-input
              type="textarea"
              v-model="profileInput"
              :rows="5"
              resize="vertical"
              placeholder="case.input" />
            <div class="answer-head">
              <span>预期输出 / 答案</span>
              <el-checkbox v-model="answerProvided">参与校验</el-checkbox>
            </div>
            <el-input
              type="textarea"
              v-model="profileAnswer"
              :rows="5"
              resize="vertical"
              placeholder="case.answer"
              @input="answerProvided = true" />
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script>
import { VideoPlay, Close, Delete, Promotion, Search } from '@element-plus/icons-vue';
import axios from 'axios';
import monacoEditor from '@/components/monacoEditor.vue';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

const TEMPLATES = {
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    int a, b;
    cout << "请输入两个整数: " << flush;
    cin >> a >> b;
    cout << "和为 " << a + b << endl;
    return 0;
}
`,
  python: `a, b = map(int, input("请输入两个整数(空格分隔): ").split())
print("和为", a + b)
`,
};

const EXT_LANG = {
  '.c': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.py': 'python',
  '.java': 'java',
  '.kt': 'kotlin',
  '.rs': 'rust',
  '.go': 'go',
  '.swift': 'swift',
  '.pas': 'pascal',
  '.cs': 'csharp',
  '.fs': 'fsharp',
};

export default {
  name: 'onlineIde',
  components: { monacoEditor, VideoPlay, Close, Delete, Promotion, Search },
  data() {
    return {
      mode: 'free',
      pidInput: '',
      problemOptions: [],
      problemSearchLoading: false,
      problemSearchSeq: 0,
      problemCtx: null,
      submitSlots: [],
      activeSlot: '0',
      multiCode: [],
      sampleIndex: null,
      profileInput: '',
      profileAnswer: '',
      answerProvided: false,
      profileLoading: false,
      profileRunning: false,
      lang: null,
      code: TEMPLATES.cpp,
      stdinBox: '',
      ws: null,
      phase: 'idle',
      exitInfo: null,
      editorHeight: 620,
      slotEditorHeight: 570,
      term: null,
      fitAddon: null,
      resizeObserver: null,
      onWinResize: null,
    };
  },
  computed: {
    langOptions() {
      const m = this.$store.state.langList || {};
      return Object.keys(m).map((id) => m[id]);
    },
    availableLangOptions() {
      if (this.mode !== 'problem' || !this.problemCtx || this.problemCtx.langMask == null) return this.langOptions;
      const mask = Number(this.problemCtx.langMask) || 0;
      return this.langOptions.filter((l) => ((1 << Number(l.id)) & mask));
    },
    editorLang() {
      const m = this.$store.state.langList || {};
      return (this.lang && m[this.lang] && m[this.lang].lang) || 'cpp';
    },
    isLive() {
      return this.phase === 'compiling' || this.phase === 'running';
    },
    isRunning() {
      return this.phase === 'running';
    },
    runLoading() {
      return this.mode === 'problem' ? this.profileRunning : this.phase === 'compiling';
    },
    runDisabled() {
      if (this.mode === 'problem') return this.profileRunning || this.profileLoading || !this.problemCtx || !this.problemCtx.runnable || !this.lang;
      return this.phase === 'running';
    },
    statusTag() {
      return {
        idle: { type: 'info', text: '空闲' },
        compiling: { type: 'warning', text: '编译中' },
        running: { type: 'success', text: '运行中' },
        done: { type: 'info', text: '已结束' },
      }[this.phase] || { type: 'info', text: '空闲' };
    },
  },
  methods: {
    async ensureLangs() {
      const current = this.$store.state.langList || {};
      if (Object.keys(current).length) return;
      try {
        const res = await axios.post('/api/judge/getLangs');
        if (res.status === 200) this.$store.state.langList = res.data.data || {};
      } catch (_) {
        this.$store.state.langList = {};
      }
    },
    onModeChange() {
      this.exitInfo = null;
      if (this.mode === 'problem') {
        if (!this.pidInput && this.$route.query.pid) this.pidInput = String(this.$route.query.pid);
      } else {
        this.onLangChange();
      }
    },
    onLangChange() {
      const tpls = Object.values(TEMPLATES);
      if (this.mode === 'free' && (!this.code.trim() || tpls.some((t) => t.trim() === this.code.trim()))) {
        this.code = TEMPLATES[this.editorLang] || TEMPLATES.cpp;
      }
      if (this.mode === 'problem' && this.problemCtx) this.refreshProblemTemplates(false);
    },
    normalizeProblemPid(value) {
      const text = String(value || '').trim().replace(/^#/, '').replace(/^p/i, '');
      const pid = Number(text);
      return Number.isSafeInteger(pid) && pid > 0 ? pid : 0;
    },
    problemOptionLabel(item) {
      return `#${item.pid} ${item.title}`;
    },
    rememberProblemOption(problem) {
      if (!problem || !problem.pid) return;
      const pid = Number(problem.pid);
      const title = problem.title || '';
      const list = this.problemOptions.filter((item) => Number(item.pid) !== pid);
      this.problemOptions = [{ pid, title }, ...list].slice(0, 20);
    },
    async searchProblems(q) {
      const query = String(q || '').trim();
      const seq = ++this.problemSearchSeq;
      if (!query) {
        this.problemSearchLoading = false;
        this.problemOptions = this.problemCtx
          ? [{ pid: this.problemCtx.pid, title: this.problemCtx.title }]
          : [];
        return;
      }
      this.problemSearchLoading = true;
      try {
        const pidQuery = this.normalizeProblemPid(query);
        const res = await axios.post('/api/auth/searchProblems', { q: pidQuery ? String(pidQuery) : query });
        if (seq !== this.problemSearchSeq) return;
        this.problemOptions = (res.data && res.data.problems) || [];
      } catch (_) {
        if (seq === this.problemSearchSeq) this.problemOptions = [];
      } finally {
        if (seq === this.problemSearchSeq) this.problemSearchLoading = false;
      }
    },
    onProblemSelect(value) {
      if (!value) return;
      this.pidInput = String(value);
      this.loadProblem();
    },
    chooseAllowedLang() {
      const opts = this.availableLangOptions;
      if (!opts.length) {
        this.lang = null;
        return;
      }
      if (!opts.some((l) => Number(l.id) === Number(this.lang))) this.lang = opts[0].id;
    },
    async loadProblem() {
      const pid = this.normalizeProblemPid(this.pidInput || (this.$route.params && this.$route.params.pid));
      if (!pid) {
        this.$message.error('题目编号非法');
        return;
      }
      this.mode = 'problem';
      this.profileLoading = true;
      try {
        const res = await axios.post('/api/ide/problemContext', { pid });
        if (res.status !== 200 || !res.data || !res.data.data) {
          this.$message.error((res.data && res.data.message) || '载入失败');
          return;
        }
        this.problemCtx = res.data.data;
        this.pidInput = String(this.problemCtx.pid);
        this.rememberProblemOption(this.problemCtx);
        this.submitSlots = this.problemCtx.submitSlots || [];
        this.activeSlot = this.submitSlots.length ? '0' : '';
        this.chooseAllowedLang();
        this.refreshProblemTemplates(true);
        if (this.problemCtx.samples && this.problemCtx.samples.length) {
          this.sampleIndex = 0;
          this.useSample(0);
        } else {
          this.sampleIndex = null;
          this.profileInput = '';
          this.profileAnswer = '';
          this.answerProvided = false;
        }
        document.title = `在线 IDE - #${this.problemCtx.pid}`;
      } catch (err) {
        const msg = err && err.response && err.response.data && err.response.data.message;
        this.$message.error(msg || '载入失败');
      } finally {
        this.profileLoading = false;
      }
    },
    refreshProblemTemplates(force) {
      const next = [];
      for (let i = 0; i < this.submitSlots.length; i++) {
        const old = this.multiCode[i] || '';
        next[i] = force || !old ? this.defaultSlotTemplate(this.submitSlots[i]) : old;
      }
      this.multiCode = next;
    },
    defaultSlotTemplate(slot) {
      const name = String(slot && slot.name || '').toLowerCase();
      if (name.endsWith('.h') || name.endsWith('.hpp')) return `// ${slot.label || slot.name || '你的实现'}\n\n`;
      if (name.endsWith('.py')) return TEMPLATES.python;
      if (!name && this.editorLang === 'python') return TEMPLATES.python;
      if (!name || name.endsWith('.c') || name.endsWith('.cc') || name.endsWith('.cpp') || name.endsWith('.cxx')) return TEMPLATES.cpp;
      return '';
    },
    slotKey(slot, i) {
      return `${i}-${slot.name || slot.label || 'slot'}`;
    },
    slotTabLabel(slot, i) {
      return slot.name || slot.label || `文件 ${i + 1}`;
    },
    setMultiContent(i, value) {
      this.multiCode.splice(i, 1, value);
    },
    editorLangForSlot(slot) {
      const name = String(slot && slot.name || '').toLowerCase();
      const ext = Object.keys(EXT_LANG).find((suffix) => name.endsWith(suffix));
      return ext ? EXT_LANG[ext] : this.editorLang;
    },
    useSelectedSample() {
      if (this.sampleIndex == null) return;
      this.useSample(this.sampleIndex);
    },
    useSample(index) {
      const sample = this.problemCtx && this.problemCtx.samples && this.problemCtx.samples[index];
      if (!sample) return;
      this.profileInput = sample.inputData || '';
      this.profileAnswer = sample.outputData || '';
      this.answerProvided = true;
    },
    clearTerminal() {
      if (this.term) this.term.clear();
      this.exitInfo = null;
    },
    write(s) {
      if (this.term) this.term.write(s);
    },
    writeLine(s) {
      if (this.term) this.term.write(s + '\r\n');
    },
    startRun() {
      if (this.mode === 'problem') this.runProfile();
      else this.run();
    },
    run() {
      if (this.isLive) return;
      if (!this.code || !this.code.trim()) {
        this.$message.error('请先写代码');
        return;
      }
      if (!this.lang) {
        this.$message.error('请选择语言');
        return;
      }
      this.exitInfo = null;
      this.term.clear();
      this.phase = 'compiling';

      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${window.location.host}/api/ide/stream`;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => {
        const { rows, cols } = this.term;
        ws.send(JSON.stringify({ op: 'start', lang: this.lang, code: this.code, rows, cols }));
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') {
          this.term.write(new Uint8Array(ev.data));
          return;
        }
        let m;
        try { m = JSON.parse(ev.data); } catch (_) { return; }
        this.onControl(m);
      };
      ws.onclose = () => {
        if (this.phase !== 'done') this.phase = 'done';
        this.ws = null;
      };
      ws.onerror = () => {
        this.writeLine('\x1b[31m[连接评测机失败]\x1b[0m');
        this.phase = 'done';
      };
    },
    async runProfile() {
      if (this.profileRunning) return;
      if (!this.problemCtx || !this.problemCtx.runnable) {
        this.$message.error('当前题目不支持 IDE 运行');
        return;
      }
      if (!this.lang) {
        this.$message.error('请选择语言');
        return;
      }
      const primaryIndex = this.submitSlots.findIndex((slot) => slot.primary);
      if (primaryIndex < 0 || !this.multiCode[primaryIndex]) {
        this.$message.error('请至少填写主文件');
        return;
      }
      for (let i = 0; i < this.submitSlots.length; i++) {
        const slot = this.submitSlots[i];
        if (!slot.optional && !this.multiCode[i]) {
          this.$message.error(`请填写文件「${slot.label || slot.name || ('文件 ' + (i + 1))}」`);
          return;
        }
      }

      this.profileRunning = true;
      this.exitInfo = null;
      this.phase = 'running';
      this.term.clear();
      this.writeLine('\x1b[2m正在运行题目评测流程…\x1b[0m');
      try {
        const res = await axios.post('/api/ide/profileRun', {
          pid: this.problemCtx.pid,
          lang: this.lang,
          files: this.submitSlots.map((_, i) => this.multiCode[i] || ''),
          input: this.profileInput,
          answer: this.profileAnswer,
          answerProvided: this.answerProvided,
        });
        if (res.status !== 200 || !res.data || !res.data.data) {
          this.$message.error((res.data && res.data.message) || '运行失败');
          return;
        }
        this.renderProfileResult(res.data.data);
      } catch (err) {
        const msg = err && err.response && err.response.data && err.response.data.message;
        this.writeLine(`\x1b[31m${msg || err.message || '运行失败'}\x1b[0m`);
        this.exitInfo = { ok: false, label: msg || '运行失败', detail: '' };
      } finally {
        this.profileRunning = false;
        this.phase = 'done';
      }
    },
    renderProfileResult(result) {
      if (result.ce) {
        this.writeLine(`\x1b[31m编译错误 (${result.compileStep || 'compile'}):\x1b[0m`);
        this.write(this.ansiText(result.compileOutput || '(无编译输出)'));
        this.write('\r\n');
        this.exitInfo = { ok: false, label: '编译错误', detail: '' };
        return;
      }
      if (result.message) this.writeLine(`\x1b[31m${this.ansiText(result.message)}\x1b[0m`);
      const ok = Number(result.result) === 4 && !result.message;
      const ratioText = result.checked ? ` · 比例 ${Math.round((result.ratio || 0) * 100)}%` : ' · 未校验';
      const detail = `用时 ${result.time || 0} ms · 内存 ${result.memory || 0} KB${ratioText}`;
      this.writeLine(`\x1b[2m[结果: ${result.resultName || '运行完成'} · ${detail}]\x1b[0m`);
      for (const step of result.steps || []) this.renderStep(step);
      this.renderAggregateSections(result, ok);
      if (result.outputTruncated) this.writeLine('\x1b[33m[输出过长，仅显示前 64KB]\x1b[0m');
      this.exitInfo = { ok, label: result.resultName || '运行完成', detail };
    },
    renderedStepTexts(steps) {
      const texts = new Set();
      for (const step of steps || []) {
        if (step.stdout) texts.add(String(step.stdout));
        if (step.stderr) texts.add(String(step.stderr));
        if (step.detail) texts.add(String(step.detail));
        for (const member of step.members || []) {
          if (member.stdout) texts.add(String(member.stdout));
          if (member.stderr) texts.add(String(member.stderr));
        }
      }
      return texts;
    },
    renderAggregateSections(result, ok) {
      const shown = this.renderedStepTexts(result.steps);
      const sections = [
        { title: 'stdout', text: result.stdout, danger: false },
        { title: 'stderr', text: result.stderr, danger: true },
        { title: 'checker', text: result.compare, danger: !ok },
      ];
      for (const section of sections) {
        if (!section.text || shown.has(String(section.text))) continue;
        this.writeSection(section.title, section.text, section.danger);
      }
    },
    renderStep(step) {
      if (step.kind === 'compile') {
        this.writeLine(`\x1b[2m[compile:${step.id}] Accepted\x1b[0m`);
        return;
      }
      if (step.kind === 'exec') {
        const status = this.statusLabel(step.status, step.exitCode);
        this.writeLine(`\x1b[2m[exec:${step.id}] ${status} · ${step.time || 0} ms · ${step.memory || 0} KB\x1b[0m`);
        if (step.stdout) this.writeSection(`${step.id}.stdout`, step.stdout);
        if (step.stderr) this.writeSection(`${step.id}.stderr`, step.stderr, true);
        return;
      }
      if (step.kind === 'check') {
        if (step.skipped) {
          this.writeLine(`\x1b[2m[check:${step.id}] ${step.reason || 'skipped'}\x1b[0m`);
          return;
        }
        this.writeLine(`\x1b[2m[check:${step.id}] ${step.resultName || ''} · ${Math.round((step.ratio || 0) * 100)}%\x1b[0m`);
        if (step.detail) this.writeSection(`${step.id}.detail`, step.detail, step.result !== 4);
        return;
      }
      if (step.kind === 'pipeGroup') {
        this.writeLine(`\x1b[2m[pipe:${step.id}] ${step.resultName || ''} · ${step.time || 0} ms · ${step.memory || 0} KB\x1b[0m`);
        for (const member of step.members || []) {
          this.writeLine(`\x1b[2m  ${member.id || 'member'} ${member.status || 'unknown'} · ${member.time || 0} ms · ${member.memory || 0} KB\x1b[0m`);
          if (member.stdout) this.writeSection('  stdout', member.stdout);
          if (member.stderr) this.writeSection('  stderr', member.stderr, true);
        }
        if (step.detail) this.writeSection(`${step.id}.detail`, step.detail, step.result !== 4);
      }
    },
    writeSection(title, text, danger) {
      if (!text) return;
      this.writeLine(`${danger ? '\x1b[31m' : '\x1b[36m'}${title}\x1b[0m`);
      this.write(this.ansiText(text));
      this.write('\r\n');
    },
    onControl(m) {
      switch (m.op) {
        case 'status':
          if (m.stage === 'compiling') {
            this.phase = 'compiling';
            this.writeLine('\x1b[2m正在编译…\x1b[0m');
          } else if (m.stage === 'running') {
            this.phase = 'running';
            this.writeLine('\x1b[2m已启动，可在此交互（Ctrl-D 结束输入）。\x1b[0m');
            this.term.focus();
          }
          break;
        case 'compile-error':
          this.phase = 'done';
          this.writeLine('\x1b[31m编译错误:\x1b[0m');
          this.write(this.ansiText(m.message || '(无编译输出)'));
          this.write('\r\n');
          this.exitInfo = { ok: false, label: '编译错误', detail: '' };
          break;
        case 'exit': {
          this.phase = 'done';
          const ok = m.status === 'Accepted' && (m.exitCode === 0 || m.exitCode == null);
          const label = this.statusLabel(m.status, m.exitCode);
          const detail = (m.time != null && m.status !== 'closed')
            ? `用时 ${m.time} ms · 内存 ${m.memory} KB · 退出码 ${m.exitCode}` : '';
          this.writeLine(`\x1b[2m[程序结束: ${label}${detail ? ' · ' + detail : ''}]\x1b[0m`);
          this.exitInfo = { ok, label, detail };
          break;
        }
        case 'fatal':
          this.phase = 'done';
          this.writeLine(`\x1b[31m${m.message || '运行失败'}\x1b[0m`);
          this.exitInfo = { ok: false, label: m.message || '运行失败', detail: '' };
          break;
        default:
          break;
      }
    },
    statusLabel(status, exitCode) {
      if (status === 'Accepted') return (exitCode === 0 || exitCode == null) ? '正常退出' : '运行错误';
      return {
        'Time Limit Exceeded': '运行超时',
        'Memory Limit Exceeded': '超出内存',
        'Output Limit Exceeded': '输出超限',
        'Nonzero Exit Status': '运行错误',
        'Signalled': '被信号终止',
        'Dangerous Syscall': '非法操作',
        'Internal Error': '评测机异常',
        'closed': '连接关闭',
      }[status] || status || '未知';
    },
    ansiText(s) {
      return String(s).replace(/\r?\n/g, '\r\n');
    },
    sendInput(data) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isRunning && this.mode === 'free') {
        this.ws.send(JSON.stringify({ op: 'input', data }));
      }
    },
    sendStdinBox() {
      if (!this.isRunning) return;
      let s = this.stdinBox;
      if (s.length && !s.endsWith('\n')) s += '\n';
      if (!s) return;
      this.sendInput(s);
    },
    sendEof() {
      this.sendInput('\x04');
    },
    stop() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 'kill' }));
      }
      try { if (this.ws) this.ws.close(); } catch (_) { /* */ }
      this.phase = 'done';
    },
    fit() {
      if (!this.fitAddon || !this.term) return;
      try { this.fitAddon.fit(); } catch (_) { /* */ }
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isRunning && this.mode === 'free') {
        this.ws.send(JSON.stringify({ op: 'resize', rows: this.term.rows, cols: this.term.cols }));
      }
    },
  },
  async mounted() {
    document.title = '在线 IDE';
    await this.ensureLangs();
    const opts = this.langOptions;
    if (opts.length) this.lang = opts[0].id;
    this.onLangChange();

    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Consolas, "Courier New", monospace',
      scrollback: 5000,
      theme: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4' },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(this.$refs.termEl);
    fitAddon.fit();
    term.writeln('\x1b[2m点「运行」编译并启动程序，然后在此交互。\x1b[0m');
    term.onData((data) => this.sendInput(data));

    this.term = term;
    this.fitAddon = fitAddon;

    this.onWinResize = () => this.fit();
    window.addEventListener('resize', this.onWinResize);
    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.fit());
      this.resizeObserver.observe(this.$refs.termEl);
    }

    const routePid = this.$route.query.pid || (this.$route.params && this.$route.params.pid);
    if (routePid) {
      this.pidInput = String(routePid);
      await this.loadProblem();
    }
  },
  beforeUnmount() {
    if (this.onWinResize) window.removeEventListener('resize', this.onWinResize);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    try { if (this.ws) { this.ws.send(JSON.stringify({ op: 'kill' })); this.ws.close(); } } catch (_) { /* */ }
    if (this.term) this.term.dispose();
  },
};
</script>

<style scoped>
.ide-page {
  --ide-bg: transparent;
  --ide-panel: #ffffff;
  --ide-border: #dfe5ef;
  --ide-text: #1f2a3d;
  --ide-muted: #748094;
  --ide-accent: #2f7de1;
  min-height: calc(100vh - 60px);
  margin: auto;
  min-width: 0;
  background: transparent;
}

.ide-shell {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 1720px;
  margin: 0 auto;
}

.ide-topbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid var(--ide-border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 22px rgba(31, 42, 61, 0.06);
}

.ide-title-block {
  min-width: 130px;
}

.eyebrow {
  color: var(--ide-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
}

h1 {
  margin: 2px 0 0;
  color: var(--ide-text);
  font-size: 24px;
  line-height: 1.2;
}

.ide-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.ide-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.ide-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.ide-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--ide-text);
  margin-right: 6px;
}

.ide-lang {
  width: 168px;
}

.ide-problem-select {
  width: 250px;
}

.ide-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(380px, 0.85fr);
  gap: 12px;
  align-items: start;
}

.ide-panel {
  min-width: 0;
  border: 1px solid var(--ide-border);
  border-radius: 8px;
  background: var(--ide-panel);
  box-shadow: 0 8px 22px rgba(31, 42, 61, 0.045);
  padding: 12px;
  text-align: left;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 34px;
  margin-bottom: 10px;
}

.panel-title,
.terminal-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ide-text);
  font-size: 15px;
  font-weight: 800;
}

.panel-meta {
  color: var(--ide-muted);
  font-size: 12px;
}

.editor-frame {
  min-width: 0;
  overflow: hidden;
  border: 1px solid #e6ebf2;
  border-radius: 8px;
}

.editor-frame :deep(.monaco-editor),
.editor-frame :deep(.overflow-guard) {
  border-radius: 8px;
}

.editor-frame :deep(.el-textarea__inner) {
  border: 0;
  border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}

.problem-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid var(--ide-border);
  border-radius: 8px;
  box-shadow: 0 8px 22px rgba(31, 42, 61, 0.045);
}

.problem-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ide-text);
}

.problem-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.slot-tabs {
  min-width: 0;
}

.slot-tabs :deep(.el-tabs__header) {
  margin-bottom: 10px;
}

.slot-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
  color: #596579;
  font-size: 13px;
}

.slot-head code {
  padding: 1px 5px;
  border-radius: 4px;
  background: #f2f5f8;
  color: var(--ide-text);
}

.ide-term {
  width: 100%;
  height: 438px;
  background: #111827;
  border: 1px solid #253044;
  border-radius: 8px;
  padding: 8px;
  box-sizing: border-box;
}

.ide-term :deep(.xterm) {
  height: 100%;
}

.ide-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.ide-meta-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
}

.ide-meta-badge.ok {
  background: #f0f9eb;
  color: #19be6b;
  border: 1px solid #b7eb8f;
}

.ide-meta-badge.bad {
  background: #fef0f0;
  color: #ed4014;
  border: 1px solid #fbc4c4;
}

.ide-meta-detail {
  font-size: 13px;
  color: var(--ide-muted);
}

.ide-input-actions,
.sample-row,
.answer-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.input-panel {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #edf1f6;
}

.input-title {
  margin-bottom: 8px;
  color: var(--ide-text);
  font-size: 13px;
  font-weight: 800;
}

.sample-row {
  margin: 0 0 10px;
}

.sample-select {
  width: 140px;
}

.answer-head {
  justify-content: space-between;
  color: #596579;
  font-size: 13px;
  margin: 12px 0 8px;
}

@media (max-width: 1100px) {
  .ide-grid {
    grid-template-columns: 1fr;
  }

  .terminal-panel {
    order: 2;
  }
}

@media (max-width: 768px) {
  .ide-page {
    background: transparent;
  }

  .ide-topbar {
    position: static;
    align-items: flex-start;
    flex-direction: column;
  }

  .ide-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .ide-term {
    height: 320px;
  }

  .ide-lang,
  .ide-pid {
    width: 130px;
  }

  .panel-head,
  .problem-strip {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
