<template>
  <div class="ide-page">
    <div class="ide-shell">
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
          <div class="panel-head editor-head">
            <div class="panel-title-wrap">
              <div class="panel-title">编辑器</div>
              <div v-if="mode === 'problem'" class="panel-meta">
                <span>{{ submitSlots.length || 0 }} 个文件</span>
              </div>
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
              <el-button plain @click="openSettings">
                <el-icon class="el-icon--left"><Setting /></el-icon>设置
              </el-button>
              <el-button plain :disabled="!canUseSourceTemplate" @click="resetEditorSource">
                <el-icon class="el-icon--left"><RefreshRight /></el-icon>重置
              </el-button>
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
                  <div class="slot-pane-body">
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
                        v-bind="editorPreferenceProps"
                        @update:value="setMultiContent(i, $event)" />
                      <el-input
                        v-else
                        type="textarea"
                        :rows="18"
                        resize="vertical"
                        :model-value="multiCode[i] || ''"
                        @input="setMultiContent(i, $event)" />
                    </div>
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
              v-bind="editorPreferenceProps"
              @update:value="setFreeCode" />
          </div>
        </section>

        <section class="ide-panel terminal-panel">
          <div class="panel-head">
            <div class="panel-title terminal-title">
              终端
              <el-tag size="small" :type="statusTag.type" effect="light" round>{{ statusTag.text }}</el-tag>
            </div>
            <div class="terminal-actions">
              <el-button class="terminal-run-button" type="primary" :loading="runLoading" :disabled="runDisabled" @click="startRun">
                <el-icon class="el-icon--left"><VideoPlay /></el-icon>运行
              </el-button>
              <el-button type="danger" plain :disabled="mode !== 'free' || !isLive" @click="stop">
                <el-icon class="el-icon--left"><Close /></el-icon>停止
              </el-button>
              <el-button plain @click="clearTerminal">
                <el-icon class="el-icon--left"><Delete /></el-icon>清空
              </el-button>
            </div>
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

      <el-dialog
        v-model="settingsVisible"
        title="IDE 设置"
        class="ide-settings-dialog"
        width="780px"
        append-to-body
        @open="syncSettingsSource">
        <el-tabs v-model="settingsTab" class="ide-settings-tabs">
          <el-tab-pane label="编辑器" name="editor">
            <el-form class="ide-settings-form" label-width="112px">
              <div class="settings-grid">
                <el-form-item label="主题">
                  <el-select v-model="settingsDraft.theme">
                    <el-option
                      v-for="item in themeOptions"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value" />
                  </el-select>
                </el-form-item>
                <el-form-item label="字号">
                  <el-input-number v-model="settingsDraft.fontSize" :min="12" :max="24" :step="1" controls-position="right" />
                </el-form-item>
                <el-form-item label="Tab 宽度">
                  <el-input-number v-model="settingsDraft.tabSize" :min="2" :max="8" :step="1" controls-position="right" />
                </el-form-item>
                <el-form-item label="缩进空格">
                  <el-switch v-model="settingsDraft.insertSpaces" />
                </el-form-item>
                <el-form-item label="自动换行">
                  <el-select v-model="settingsDraft.wordWrap">
                    <el-option
                      v-for="item in wordWrapOptions"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value" />
                  </el-select>
                </el-form-item>
                <el-form-item label="小地图">
                  <el-switch v-model="settingsDraft.minimap" />
                </el-form-item>
                <el-form-item label="行号">
                  <el-select v-model="settingsDraft.lineNumbers">
                    <el-option
                      v-for="item in lineNumberOptions"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value" />
                  </el-select>
                </el-form-item>
                <el-form-item label="空白字符">
                  <el-select v-model="settingsDraft.renderWhitespace">
                    <el-option
                      v-for="item in whitespaceOptions"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value" />
                  </el-select>
                </el-form-item>
                <el-form-item label="括号着色">
                  <el-switch v-model="settingsDraft.bracketPairColorization" />
                </el-form-item>
                <el-form-item label="括号引导线">
                  <el-switch v-model="settingsDraft.bracketPairGuides" />
                </el-form-item>
              </div>
            </el-form>
          </el-tab-pane>

          <el-tab-pane label="缺省源" name="source">
            <div class="settings-source-head">
              <el-select v-model="settingsSourceLang" class="settings-lang-select" @change="syncSettingsSource">
                <el-option
                  v-for="item in sourceLangOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value" />
              </el-select>
              <div class="settings-source-actions">
                <el-button plain :disabled="!canUseSourceTemplate" @click="useCurrentSourceInSettings">
                  <el-icon class="el-icon--left"><DocumentChecked /></el-icon>使用当前代码
                </el-button>
                <el-button plain @click="restoreSystemSourceInSettings">
                  <el-icon class="el-icon--left"><RefreshRight /></el-icon>系统模板
                </el-button>
                <el-button type="primary" @click="saveSettingsSource">
                  <el-icon class="el-icon--left"><DocumentChecked /></el-icon>保存缺省源
                </el-button>
              </div>
            </div>
            <div class="settings-source-editor">
              <monacoEditor
                :value="settingsSourceDraft"
                :language="settingsSourceLang"
                :height="330"
                v-bind="settingsPreviewProps"
                @update:value="settingsSourceDraft = $event" />
            </div>
          </el-tab-pane>

          <el-tab-pane label="草稿" name="drafts">
            <div class="settings-draft-actions">
              <el-button plain @click="clearCurrentFreeDraft">清空当前自由草稿</el-button>
              <el-button plain @click="clearCurrentProblemDraft">清空当前题目草稿</el-button>
              <el-button plain type="danger" @click="clearAllProblemDrafts">清空全部题目草稿</el-button>
            </div>
          </el-tab-pane>
        </el-tabs>
        <template #footer>
          <el-button @click="resetEditorSettingsDraft">恢复默认</el-button>
          <el-button @click="settingsVisible = false">关闭</el-button>
          <el-button type="primary" @click="saveEditorSettings">保存编辑器设置</el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<script>
import axios from 'axios';
import monacoEditor from '@/components/monacoEditor.vue';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

const TEMPLATES = {
  c: `#include <stdio.h>

int main(void) {
    int a, b;
    scanf("%d%d", &a, &b);
    printf("%d\\n", a + b);
    return 0;
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    int a, b;
    cin >> a >> b;
    cout << a + b << endl;
    return 0;
}
`,
  python: `a, b = map(int, input("请输入两个整数(空格分隔): ").split())
print("和为", a + b)
`,
};

const STORAGE_KEYS = {
  defaultSources: 'nywoj.ide.defaultSources.v1',
  editorPrefs: 'nywoj.ide.editorPrefs.v1',
  freeDrafts: 'nywoj.ide.freeDrafts.v1',
  problemDrafts: 'nywoj.ide.problemDrafts.v1',
};

const EDITOR_DEFAULTS = {
  theme: 'vs-light',
  fontSize: 15,
  tabSize: 4,
  insertSpaces: true,
  wordWrap: 'off',
  minimap: false,
  lineNumbers: 'on',
  renderWhitespace: 'selection',
  bracketPairColorization: true,
  bracketPairGuides: false,
};

const THEME_OPTIONS = [
  { value: 'vs-light', label: '浅色' },
  { value: 'vs-dark', label: '深色' },
  { value: 'hc-black', label: '高对比黑' },
];

const WORD_WRAP_OPTIONS = [
  { value: 'off', label: '关闭' },
  { value: 'on', label: '开启' },
  { value: 'bounded', label: '边界' },
];

const LINE_NUMBER_OPTIONS = [
  { value: 'on', label: '显示' },
  { value: 'off', label: '隐藏' },
  { value: 'relative', label: '相对' },
  { value: 'interval', label: '间隔' },
];

const WHITESPACE_OPTIONS = [
  { value: 'selection', label: '选区' },
  { value: 'boundary', label: '边界' },
  { value: 'trailing', label: '行尾' },
  { value: 'all', label: '全部' },
  { value: 'none', label: '隐藏' },
];

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
  components: { monacoEditor },
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
      editorHeight: 420,
      slotEditorHeight: 420,
      term: null,
      fitAddon: null,
      resizeObserver: null,
      onWinResize: null,
      layoutRaf: null,
      freeDraftLang: '',
      problemDraftKey: '',
      editorPrefs: { ...EDITOR_DEFAULTS },
      settingsVisible: false,
      settingsTab: 'editor',
      settingsDraft: { ...EDITOR_DEFAULTS },
      settingsSourceLang: 'cpp',
      settingsSourceDraft: '',
    };
  },
  computed: {
    themeOptions() {
      return THEME_OPTIONS;
    },
    wordWrapOptions() {
      return WORD_WRAP_OPTIONS;
    },
    lineNumberOptions() {
      return LINE_NUMBER_OPTIONS;
    },
    whitespaceOptions() {
      return WHITESPACE_OPTIONS;
    },
    langOptions() {
      const m = this.$store.state.langList || {};
      return Object.keys(m).map((id) => m[id]);
    },
    sourceLangOptions() {
      const seen = new Set();
      const options = [];
      const add = (value, label) => {
        const key = this.storageLangKey(value);
        if (!key || seen.has(key)) return;
        seen.add(key);
        options.push({ value: key, label: label || key });
      };
      this.langOptions.forEach((l) => add(l.lang, l.des || l.name || l.lang));
      Object.keys(TEMPLATES).forEach((key) => add(key, key));
      add(this.activeSourceLang(), this.activeSourceLang());
      return options;
    },
    availableLangOptions() {
      if (this.mode !== 'problem' || !this.problemCtx || this.problemCtx.langMask == null) return this.langOptions;
      const mask = Number(this.problemCtx.langMask) || 0;
      return this.langOptions.filter((l) => ((1 << Number(l.id)) & mask));
    },
    editorPreferenceProps() {
      return { ...this.editorPrefs };
    },
    settingsPreviewProps() {
      return { ...this.normalizeEditorPrefs(this.settingsDraft) };
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
    canUseSourceTemplate() {
      if (!this.lang) return false;
      if (this.mode === 'free') return true;
      const slot = this.activeSubmitSlot();
      return !!slot && slot.kind === 'source';
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
  watch: {
    mode() {
      this.$nextTick(this.updateLayoutHeights);
    },
    problemCtx() {
      this.$nextTick(this.updateLayoutHeights);
    },
    activeSlot() {
      this.$nextTick(this.updateLayoutHeights);
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
      this.$nextTick(this.updateLayoutHeights);
    },
    onLangChange() {
      if (this.mode === 'free') {
        if (this.freeDraftLang) this.saveFreeDraft(this.freeDraftLang, this.code);
        this.freeDraftLang = this.editorLang;
        this.code = this.loadFreeDraft(this.editorLang);
        return;
      }
      if (this.mode === 'problem' && this.problemCtx) {
        if (!this.loadProblemDraft()) this.refreshProblemTemplates(true);
      }
    },
    storageLangKey(lang) {
      return String(lang || 'cpp').trim().toLowerCase() || 'cpp';
    },
    readStorageMap(key) {
      try {
        const raw = window.localStorage && window.localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch (_) {
        return {};
      }
    },
    writeStorageMap(key, value) {
      try {
        if (window.localStorage) window.localStorage.setItem(key, JSON.stringify(value || {}));
      } catch (_) {
        // Ignore quota/privacy-mode errors; the editor should still work.
      }
    },
    optionValue(options, value, fallback) {
      return options.some((item) => item.value === value) ? value : fallback;
    },
    numberInRange(value, min, max, fallback) {
      const next = Number(value);
      if (!Number.isFinite(next)) return fallback;
      return Math.min(max, Math.max(min, Math.round(next)));
    },
    boolPref(raw, key) {
      return raw && Object.prototype.hasOwnProperty.call(raw, key)
        ? !!raw[key]
        : EDITOR_DEFAULTS[key];
    },
    normalizeEditorPrefs(raw) {
      const prefs = raw && typeof raw === 'object' ? raw : {};
      return {
        theme: this.optionValue(THEME_OPTIONS, prefs.theme, EDITOR_DEFAULTS.theme),
        fontSize: this.numberInRange(prefs.fontSize, 12, 24, EDITOR_DEFAULTS.fontSize),
        tabSize: this.numberInRange(prefs.tabSize, 2, 8, EDITOR_DEFAULTS.tabSize),
        insertSpaces: this.boolPref(prefs, 'insertSpaces'),
        wordWrap: this.optionValue(WORD_WRAP_OPTIONS, prefs.wordWrap, EDITOR_DEFAULTS.wordWrap),
        minimap: this.boolPref(prefs, 'minimap'),
        lineNumbers: this.optionValue(LINE_NUMBER_OPTIONS, prefs.lineNumbers, EDITOR_DEFAULTS.lineNumbers),
        renderWhitespace: this.optionValue(WHITESPACE_OPTIONS, prefs.renderWhitespace, EDITOR_DEFAULTS.renderWhitespace),
        bracketPairColorization: this.boolPref(prefs, 'bracketPairColorization'),
        bracketPairGuides: this.boolPref(prefs, 'bracketPairGuides'),
      };
    },
    loadEditorPrefs() {
      return this.normalizeEditorPrefs(this.readStorageMap(STORAGE_KEYS.editorPrefs));
    },
    writeEditorPrefs(value) {
      const prefs = this.normalizeEditorPrefs(value);
      this.writeStorageMap(STORAGE_KEYS.editorPrefs, prefs);
      this.editorPrefs = prefs;
      return prefs;
    },
    systemTemplateForLang(lang) {
      const key = this.storageLangKey(lang);
      return TEMPLATES[key] || TEMPLATES.cpp;
    },
    defaultSourceForLang(lang) {
      const key = this.storageLangKey(lang);
      const defaults = this.readStorageMap(STORAGE_KEYS.defaultSources);
      return Object.prototype.hasOwnProperty.call(defaults, key)
        ? String(defaults[key] || '')
        : this.systemTemplateForLang(key);
    },
    loadFreeDraft(lang) {
      const key = this.storageLangKey(lang);
      const drafts = this.readStorageMap(STORAGE_KEYS.freeDrafts);
      return Object.prototype.hasOwnProperty.call(drafts, key)
        ? String(drafts[key] || '')
        : this.defaultSourceForLang(key);
    },
    saveFreeDraft(lang, source) {
      const key = this.storageLangKey(lang);
      const drafts = this.readStorageMap(STORAGE_KEYS.freeDrafts);
      drafts[key] = String(source || '');
      this.writeStorageMap(STORAGE_KEYS.freeDrafts, drafts);
    },
    setFreeCode(value) {
      this.code = value;
      if (this.mode === 'free') {
        this.freeDraftLang = this.editorLang;
        this.saveFreeDraft(this.editorLang, value);
      }
    },
    activeSlotIndex() {
      const index = Number(this.activeSlot);
      return Number.isSafeInteger(index) && index >= 0 ? index : -1;
    },
    activeSubmitSlot() {
      const index = this.activeSlotIndex();
      return index >= 0 ? this.submitSlots[index] : null;
    },
    activeSourceLang() {
      if (this.mode === 'problem') {
        const slot = this.activeSubmitSlot();
        return slot && slot.kind === 'source' ? this.editorLangForSlot(slot) : '';
      }
      return this.editorLang;
    },
    activeSourceValue() {
      if (this.mode === 'problem') {
        const index = this.activeSlotIndex();
        return index >= 0 ? (this.multiCode[index] || '') : '';
      }
      return this.code;
    },
    saveDefaultSource() {
      if (!this.canUseSourceTemplate) return;
      const lang = this.activeSourceLang();
      const key = this.storageLangKey(lang);
      const defaults = this.readStorageMap(STORAGE_KEYS.defaultSources);
      defaults[key] = this.activeSourceValue();
      this.writeStorageMap(STORAGE_KEYS.defaultSources, defaults);
      this.$message.success('缺省源已保存');
    },
    openSettings() {
      this.settingsDraft = { ...this.editorPrefs };
      this.settingsSourceLang = this.storageLangKey(this.activeSourceLang() || this.editorLang || 'cpp');
      this.syncSettingsSource();
      this.settingsVisible = true;
    },
    syncSettingsSource() {
      const lang = this.storageLangKey(this.settingsSourceLang || this.activeSourceLang() || this.editorLang || 'cpp');
      this.settingsSourceLang = lang;
      this.settingsSourceDraft = this.defaultSourceForLang(lang);
    },
    useCurrentSourceInSettings() {
      if (!this.canUseSourceTemplate) return;
      this.settingsSourceLang = this.storageLangKey(this.activeSourceLang());
      this.settingsSourceDraft = this.activeSourceValue();
      this.settingsTab = 'source';
    },
    restoreSystemSourceInSettings() {
      const lang = this.storageLangKey(this.settingsSourceLang || 'cpp');
      this.settingsSourceDraft = this.systemTemplateForLang(lang);
    },
    saveSettingsSource() {
      const key = this.storageLangKey(this.settingsSourceLang || 'cpp');
      const defaults = this.readStorageMap(STORAGE_KEYS.defaultSources);
      defaults[key] = String(this.settingsSourceDraft || '');
      this.writeStorageMap(STORAGE_KEYS.defaultSources, defaults);
      this.$message.success('缺省源已保存');
    },
    saveEditorSettings() {
      this.settingsDraft = this.writeEditorPrefs(this.settingsDraft);
      this.$nextTick(this.updateLayoutHeights);
      this.$message.success('编辑器设置已保存');
    },
    resetEditorSettingsDraft() {
      this.settingsDraft = { ...EDITOR_DEFAULTS };
    },
    clearCurrentFreeDraft() {
      const key = this.storageLangKey(this.editorLang || 'cpp');
      const drafts = this.readStorageMap(STORAGE_KEYS.freeDrafts);
      delete drafts[key];
      this.writeStorageMap(STORAGE_KEYS.freeDrafts, drafts);
      if (this.mode === 'free') {
        this.freeDraftLang = key;
        this.code = this.defaultSourceForLang(key);
      }
      this.$message.success('当前自由草稿已清空');
    },
    clearCurrentProblemDraft() {
      const key = this.currentProblemDraftKey() || this.problemDraftKey;
      if (!key) {
        this.$message.warning('当前没有题目草稿');
        return;
      }
      const drafts = this.readStorageMap(STORAGE_KEYS.problemDrafts);
      delete drafts[key];
      this.writeStorageMap(STORAGE_KEYS.problemDrafts, drafts);
      if (this.mode === 'problem' && this.problemCtx) this.refreshProblemTemplates(true);
      this.$message.success('当前题目草稿已清空');
    },
    clearAllProblemDrafts() {
      this.writeStorageMap(STORAGE_KEYS.problemDrafts, {});
      if (this.mode === 'problem' && this.problemCtx) this.refreshProblemTemplates(true);
      this.$message.success('全部题目草稿已清空');
    },
    resetEditorSource() {
      if (!this.canUseSourceTemplate) return;
      if (this.mode === 'problem') {
        const index = this.activeSlotIndex();
        const slot = this.activeSubmitSlot();
        if (index < 0 || !slot) return;
        this.setMultiContent(index, this.defaultSlotTemplate(slot));
      } else {
        this.setFreeCode(this.defaultSourceForLang(this.editorLang));
      }
      this.$message.success('已重置为缺省源');
    },
    problemSlotSignature() {
      return this.submitSlots
        .map((slot) => [slot.kind || '', slot.name || '', slot.label || ''].join(':'))
        .join('|');
    },
    currentProblemDraftKey() {
      if (!this.problemCtx || !this.problemCtx.pid || !this.lang) return '';
      return [
        this.problemCtx.pid,
        this.lang,
        this.problemSlotSignature(),
      ].join('::');
    },
    loadProblemDraft() {
      const key = this.currentProblemDraftKey();
      this.problemDraftKey = key;
      if (!key) return false;
      const drafts = this.readStorageMap(STORAGE_KEYS.problemDrafts);
      const saved = drafts[key];
      if (!saved || !Array.isArray(saved.files)) return false;
      this.multiCode = this.submitSlots.map((slot, i) => (
        Object.prototype.hasOwnProperty.call(saved.files, i)
          ? String(saved.files[i] || '')
          : this.defaultSlotTemplate(slot)
      ));
      return true;
    },
    saveProblemDraft() {
      const key = this.problemDraftKey || this.currentProblemDraftKey();
      if (!key) return;
      this.problemDraftKey = key;
      const drafts = this.readStorageMap(STORAGE_KEYS.problemDrafts);
      drafts[key] = {
        files: this.multiCode.map((source) => String(source || '')),
        updatedAt: Date.now(),
      };
      this.writeStorageMap(STORAGE_KEYS.problemDrafts, drafts);
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
        if (!this.loadProblemDraft()) this.refreshProblemTemplates(true);
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
        this.$nextTick(this.updateLayoutHeights);
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
      this.problemDraftKey = this.currentProblemDraftKey();
    },
    defaultSlotTemplate(slot) {
      const name = String(slot && slot.name || '').toLowerCase();
      if (name.endsWith('.h') || name.endsWith('.hpp')) return `// ${slot.label || slot.name || '你的实现'}\n\n`;
      const lang = this.editorLangForSlot(slot);
      if (!name || EXT_LANG[Object.keys(EXT_LANG).find((suffix) => name.endsWith(suffix))] || slot.kind === 'source') {
        return this.defaultSourceForLang(lang);
      }
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
      this.saveProblemDraft();
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
    normalizeTerminalInput(data) {
      return String(data == null ? '' : data).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    },
    echoTerminalInput(data) {
      if (!this.term || !data) return;
      let out = '';
      for (const ch of String(data)) {
        const code = ch.codePointAt(0);
        if (ch === '\n') out += '\r\n';
        else if (ch === '\b' || ch === '\x7f') out += '\b \b';
        else if (ch === '\t' || code >= 0x20) out += ch;
      }
      if (out) this.term.write(out);
    },
    sendInput(data, options = {}) {
      const normalized = this.normalizeTerminalInput(data);
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isRunning && this.mode === 'free') {
        if (options.echo !== false) this.echoTerminalInput(normalized);
        this.ws.send(JSON.stringify({ op: 'input', data: normalized }));
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
    updateLayoutHeights() {
      if (this.layoutRaf) window.cancelAnimationFrame(this.layoutRaf);
      this.layoutRaf = window.requestAnimationFrame(() => {
        this.layoutRaf = null;
        this.$nextTick(() => {
          const root = this.$el;
          if (!root) return;
          const frames = Array.from(root.querySelectorAll('.editor-panel .editor-frame'));
          const frame = frames.find((el) => el.offsetParent !== null && el.clientHeight > 0)
            || frames.find((el) => el.clientHeight > 0);
          if (frame) {
            const nextHeight = Math.max(260, Math.floor(frame.clientHeight));
            if (this.editorHeight !== nextHeight) this.editorHeight = nextHeight;
            if (this.slotEditorHeight !== nextHeight) this.slotEditorHeight = nextHeight;
          }
          this.fit();
        });
      });
    },
  },
  async mounted() {
    document.title = '在线 IDE';
    this.editorPrefs = this.loadEditorPrefs();
    this.settingsDraft = { ...this.editorPrefs };
    await this.ensureLangs();
    const opts = this.langOptions;
    if (opts.length) this.lang = opts[0].id;
    this.freeDraftLang = this.editorLang;
    this.code = this.loadFreeDraft(this.editorLang);

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

    this.updateLayoutHeights();

    this.onWinResize = () => {
      this.updateLayoutHeights();
      this.fit();
    };
    window.addEventListener('resize', this.onWinResize);
    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.updateLayoutHeights());
      const editorPanel = this.$el && this.$el.querySelector('.editor-panel');
      if (editorPanel) this.resizeObserver.observe(editorPanel);
      if (this.$refs.termEl) this.resizeObserver.observe(this.$refs.termEl);
    }

    const routePid = this.$route.query.pid || (this.$route.params && this.$route.params.pid);
    if (routePid) {
      this.pidInput = String(routePid);
      await this.loadProblem();
    }
  },
  beforeUnmount() {
    if (this.mode === 'free') this.saveFreeDraft(this.freeDraftLang || this.editorLang, this.code);
    else this.saveProblemDraft();
    if (this.onWinResize) window.removeEventListener('resize', this.onWinResize);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.layoutRaf) window.cancelAnimationFrame(this.layoutRaf);
    try { if (this.ws) { this.ws.send(JSON.stringify({ op: 'kill' })); this.ws.close(); } } catch (_) { /* */ }
    if (this.term) this.term.dispose();
  },
};
</script>

<style scoped>
.ide-page {
  --ide-app-header-height: 60px;
  --ide-bg: transparent;
  --ide-panel: #ffffff;
  --ide-border: #dfe5ef;
  --ide-text: #1f2a3d;
  --ide-muted: #748094;
  --ide-accent: #2f7de1;
  --ide-main-y-padding: 40px;
  --ide-min-page-height: 620px;
  height: calc(100vh - var(--ide-app-header-height) - var(--ide-main-y-padding));
  height: calc(100dvh - var(--ide-app-header-height) - var(--ide-main-y-padding));
  min-height: var(--ide-min-page-height);
  margin: auto;
  min-width: 0;
  background: transparent;
  overflow: hidden;
  box-sizing: border-box;
}

.ide-shell {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  max-width: 1720px;
  margin: 0 auto;
}

.ide-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
  margin-left: auto;
}

.ide-actions :deep(.el-button + .el-button) {
  margin-left: 0;
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
  grid-auto-rows: minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
  flex: 1;
  min-height: 0;
}

.ide-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  border: 1px solid var(--ide-border);
  border-radius: 8px;
  background: var(--ide-panel);
  box-shadow: 0 8px 22px rgba(31, 42, 61, 0.045);
  padding: 12px;
  text-align: left;
  overflow: hidden;
}

.editor-panel,
.terminal-panel {
  height: 100%;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 34px;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.editor-head {
  align-items: flex-start;
}

.panel-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  min-width: max-content;
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

.terminal-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.terminal-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.terminal-run-button {
  min-width: 94px;
  font-weight: 700;
}

.editor-frame {
  flex: 1;
  min-width: 0;
  min-height: 0;
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
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.slot-tabs :deep(.el-tabs__header) {
  flex-shrink: 0;
  margin-bottom: 10px;
}

.slot-tabs :deep(.el-tabs__content),
.slot-tabs :deep(.el-tab-pane) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.slot-tabs :deep(.el-tab-pane) {
  height: 100%;
}

.slot-pane-body {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
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
  flex: 1;
  width: 100%;
  height: auto;
  min-height: 220px;
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
  flex-shrink: 0;
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

.ide-settings-tabs :deep(.el-tabs__content) {
  min-height: 380px;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 18px;
}

.ide-settings-form :deep(.el-select),
.ide-settings-form :deep(.el-input-number) {
  width: 100%;
}

.settings-source-head,
.settings-source-actions,
.settings-draft-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.settings-source-head {
  justify-content: space-between;
  margin-bottom: 12px;
}

.settings-lang-select {
  width: 180px;
}

.settings-source-actions {
  justify-content: flex-end;
}

.settings-source-actions :deep(.el-button + .el-button),
.settings-draft-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.settings-source-editor {
  min-height: 330px;
  overflow: hidden;
  border: 1px solid #e6ebf2;
  border-radius: 8px;
}

.settings-source-editor :deep(.monaco-editor),
.settings-source-editor :deep(.overflow-guard) {
  border-radius: 8px;
}

.settings-draft-actions {
  align-items: flex-start;
  padding-top: 8px;
}

@media (max-width: 1100px) {
  .ide-page {
    height: auto;
    min-height: var(--ide-min-page-height);
    overflow: visible;
  }

  .ide-shell,
  .ide-grid,
  .ide-panel {
    height: auto;
  }

  .ide-grid {
    grid-template-columns: 1fr;
    grid-auto-rows: auto;
    min-height: 0;
  }

  .terminal-panel {
    order: 2;
  }
}

@media (max-width: 768px) {
  .ide-page {
    background: transparent;
  }

  .ide-actions {
    margin-left: 0;
    width: 100%;
    justify-content: flex-start;
  }

  .terminal-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .ide-term {
    height: 320px;
    flex: none;
  }

  .settings-grid {
    grid-template-columns: 1fr;
  }

  .settings-source-head,
  .settings-source-actions {
    align-items: stretch;
  }

  .settings-lang-select,
  .settings-source-actions,
  .settings-source-actions :deep(.el-button) {
    width: 100%;
  }

  .ide-lang,
  .ide-problem-select {
    width: 130px;
  }

  .editor-head,
  .problem-strip {
    align-items: flex-start;
    flex-direction: column;
  }

  .panel-title-wrap {
    min-width: 0;
  }
}
</style>
