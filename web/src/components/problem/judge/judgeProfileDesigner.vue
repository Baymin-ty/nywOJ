<template>
  <div class="designer" v-loading="loading">
    <!-- 顶部：当前题型 + 视图切换 + 保存 -->
    <div class="toolbar">
      <div class="current-type">
        <span class="current-type-label">当前题型</span>
        <el-tag size="large" effect="dark" type="primary">{{ presetLabel(profile.preset) }}</el-tag>
        <el-tag v-if="dirty" type="warning" size="small" effect="plain">有未保存改动</el-tag>
      </div>
      <div class="toolbar-actions">
        <el-radio-group v-model="view" size="small" @change="onViewChange">
          <el-radio-button value="visual">可视化</el-radio-button>
          <el-radio-button value="yaml">YAML 源码</el-radio-button>
        </el-radio-group>
        <el-button type="primary" size="small" :disabled="!auth.manage || (view === 'yaml' && !!yamlError)"
          :loading="saving" @click="save">
          <el-icon class="el-icon--left">
            <CircleCheck />
          </el-icon>
          保存评测流程
        </el-button>
      </div>
    </div>

    <!-- ============ 可视化视图 ============ -->
    <div v-if="view === 'visual'" class="visual">
      <!-- ① 题型预设 -->
      <section class="block">
        <div class="block-head">
          <div>
            <span class="block-num">①</span>
            <span class="block-title">题型</span>
            <span class="block-sub">点击卡片套用该题型的起始流程（会覆盖下面的所有配置），再按需微调</span>
          </div>
        </div>
        <div class="presets">
          <div v-for="p in presetCards" :key="p.id" class="preset-card"
            :class="{ active: profile.preset === p.id }" @click="applyPreset(p.id)">
            <el-icon class="preset-icon">
              <component :is="p.icon" />
            </el-icon>
            <div class="preset-text">
              <div class="preset-label">{{ p.label }}</div>
              <div class="preset-desc">{{ p.desc }}</div>
            </div>
            <el-icon v-if="profile.preset === p.id" class="preset-check"><CircleCheck /></el-icon>
          </div>
        </div>
      </section>

      <!-- ② 提交内容 -->
      <section class="block">
        <div class="block-head">
          <div>
            <span class="block-num">②</span>
            <span class="block-title">选手提交什么</span>
            <span class="block-sub">提交页会按这里的文件槽渲染；第一个代码槽是主文件</span>
          </div>
          <div>
            <el-select v-model="profile.submit.mode" size="small" style="width: 130px;">
              <el-option label="提交代码" value="code" />
              <el-option label="提交答案" value="answer" />
            </el-select>
            <el-button v-if="profile.submit.mode === 'code'" size="small" plain class="ml8"
              @click="addSlot">
              <el-icon class="el-icon--left">
                <Plus />
              </el-icon>新增文件槽
            </el-button>
          </div>
        </div>
        <el-empty v-if="profile.submit.mode === 'answer'" :image-size="60"
          description="提交答案题：选手为每个测试点上传 .out，无需代码" />
        <div v-else class="slot-grid">
          <div v-for="(f, i) in profile.submit.files" :key="i" class="slot-card">
            <div class="slot-card-head">
              <span class="slot-idx">文件 {{ i + 1 }}<span v-if="i === 0" class="slot-primary">主</span></span>
              <el-button link type="danger" size="small" :disabled="i === 0 && profile.submit.files.length === 1"
                @click="profile.submit.files.splice(i, 1)">
                <el-icon>
                  <Close />
                </el-icon>
              </el-button>
            </div>
            <div class="kv"><span class="k">文件名</span>
              <el-input v-model="f.name" size="small" placeholder="留空=按语言，如 solution.h" />
            </div>
            <div class="kv"><span class="k">展示名</span>
              <el-input v-model="f.label" size="small" />
            </div>
            <div class="kv"><span class="k">类型</span>
              <el-select v-model="f.kind" size="small">
                <el-option label="代码(编辑器)" value="source" />
                <el-option label="文件(上传)" value="file" />
              </el-select>
            </div>
            <div class="kv"><span class="k">大小KB</span>
              <el-input-number v-model="f.maxKB" size="small" :min="1" :max="1024" controls-position="right"
                style="width: 110px;" />
            </div>
          </div>
        </div>
      </section>

      <!-- ③ 出题人资产 -->
      <section class="block">
        <div class="block-head">
          <div>
            <span class="block-num">③</span>
            <span class="block-title">出题人资产</span>
            <span class="block-sub">checker / interactor / grader / 头文件等，在线编辑或随数据 ZIP 上传</span>
          </div>
          <div class="asset-add">
            <el-button v-for="q in quickAssets" :key="q" size="small" plain
              :disabled="assetNames.includes(q)" @click="ensureAsset(q)">{{ q }}</el-button>
            <el-input v-model="newAssetName" size="small" placeholder="自定义文件名"
              style="width: 180px;" class="ml8" @keyup.enter="addAsset" />
            <el-button size="small" plain class="ml8" @click="addAsset">
              <el-icon class="el-icon--left">
                <Plus />
              </el-icon>新建
            </el-button>
          </div>
        </div>
        <div class="asset-layout">
          <div class="asset-list">
            <el-empty v-if="!assets.length" :image-size="50" description="暂无资产" />
            <div v-for="a in assets" :key="a.name" class="asset-item"
              :class="{ active: activeAsset === a.name }" @click="openAsset(a.name)">
              <el-icon>
                <Document />
              </el-icon>
              <span class="asset-name">{{ a.name }}</span>
              <span class="asset-size">{{ fmtSize(a.size) }}</span>
              <el-button link type="primary" size="small" @click.stop="renameAsset(a.name)">
                <el-icon>
                  <Edit />
                </el-icon>
              </el-button>
              <el-button link type="success" size="small" @click.stop="downloadAsset(a.name)">
                <el-icon>
                  <Download />
                </el-icon>
              </el-button>
              <el-button link type="danger" size="small" @click.stop="removeAsset(a.name)">
                <el-icon>
                  <Delete />
                </el-icon>
              </el-button>
            </div>
          </div>
          <div class="asset-editor">
            <div v-if="!activeAsset" class="asset-placeholder">选择左侧文件以编辑内容</div>
            <template v-else>
              <div class="asset-editor-head">
                <span>{{ activeAsset }}</span>
                <div>
                  <el-tag v-if="assetDirty" type="warning" size="small" effect="plain" class="mr8">未保存</el-tag>
                  <el-button size="small" type="primary" :loading="assetSaving"
                    :disabled="!auth.manage || !assetDirty" @click="saveActiveAsset">保存内容</el-button>
                </div>
              </div>
              <monaco-editor v-model:value="assetContent" :language="assetLang" :height="320"
                :read-only="!auth.manage" />
            </template>
          </div>
        </div>
      </section>

      <!-- ④ 编译步骤 -->
      <section class="block">
        <div class="block-head">
          <div>
            <span class="block-num">④</span>
            <span class="block-title">编译</span>
            <span class="block-sub">把「提交文件 + 资产」编译成可执行文件；下面的运行步骤用产物名引用它</span>
          </div>
          <el-button size="small" plain @click="addCompile">
            <el-icon class="el-icon--left">
              <Plus />
            </el-icon>新增编译步骤
          </el-button>
        </div>
        <el-empty v-if="!profile.compile.length" :image-size="50" description="无需编译（如提交答案题）" />
        <div v-for="(c, ci) in profile.compile" :key="ci" class="step-card">
          <div class="step-card-head">
            <span class="step-badge step-compile">编译</span>
            <span class="k2">产物名</span>
            <el-input v-model="c.id" size="small" style="width: 130px;" placeholder="可执行文件名 如 main" />
            <span class="hint">← 运行步骤用这名字引用它</span>
            <div class="grow"></div>
            <el-button link type="danger" size="small" @click="profile.compile.splice(ci, 1)">
              <el-icon>
                <Delete />
              </el-icon>
            </el-button>
          </div>
          <div class="kv">
            <span class="k">编译方式</span>
            <el-radio-group :model-value="c.command === 'auto' ? 'auto' : 'custom'" size="small"
              @change="(v) => setCompileMode(c, v)">
              <el-radio-button value="auto">编译选手主代码（自动）</el-radio-button>
              <el-radio-button value="custom">自定义（选文件 + 写命令）</el-radio-button>
            </el-radio-group>
          </div>
          <div v-if="c.command === 'auto'" class="auto-note">
            <el-icon>
              <InfoFilled />
            </el-icon>
            <span>输入 = 选手主代码；文件名与编译命令按选手所选语言自动决定，生成可执行文件「{{ c.id }}」。仅适合「只编译选手那一个文件」。</span>
          </div>
          <template v-else>
            <div class="kv"><span class="k">输入文件</span>
              <el-select v-model="c.inputs" multiple filterable style="width: 100%;"
                placeholder="从选手文件 / 出题人资产里选要一起编译的文件">
                <el-option-group label="选手提交的文件">
                  <el-option v-for="o in submitFileOptions" :key="'s' + o.value" :label="o.label" :value="o.value" />
                </el-option-group>
                <el-option-group label="出题人资产">
                  <el-option v-for="n in assetNames" :key="'a' + n" :label="n" :value="n" />
                </el-option-group>
              </el-select>
            </div>
            <div class="sub-label">编译命令（每行一个参数，产物请用 <code>-o {{ c.id }}</code>）</div>
            <el-input type="textarea" :rows="3" :model-value="cmdText(c)" @input="(v) => setCmdText(c, v)"
              class="cmd-input" placeholder="/usr/bin/g++-9&#10;-O2&#10;grader.cpp&#10;-o&#10;prog" />
          </template>
        </div>
      </section>

      <!-- ⑤ 运行步骤 -->
      <section class="block">
        <div class="block-head">
          <div>
            <span class="block-num">⑤</span>
            <span class="block-title">每个测试点：运行与裁决</span>
            <span class="block-sub">按顺序执行；输入可取测试点输入 / 资产 / 之前步骤的输出，最后一个裁决步骤决定得分</span>
          </div>
          <el-dropdown @command="addRunStep">
            <el-button size="small" plain>
              <el-icon class="el-icon--left">
                <Plus />
              </el-icon>新增运行步骤<el-icon class="el-icon--right">
                <ArrowDown />
              </el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="exec">运行 (exec)</el-dropdown-item>
                <el-dropdown-item command="check">裁决 (check)</el-dropdown-item>
                <el-dropdown-item command="pipeGroup">管道组 (交互/通信)</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div v-for="(s, si) in profile.run.perCase" :key="si" class="step-card">
          <div class="step-card-head">
            <span class="step-badge" :class="'step-' + s.kind">{{ stepLabel(s.kind) }}</span>
            <el-input v-model="s.id" size="small" style="width: 120px;" placeholder="步骤 id" />
            <div class="grow"></div>
            <el-button link size="small" :disabled="si === 0" @click="moveStep(si, -1)">
              <el-icon>
                <Top />
              </el-icon>
            </el-button>
            <el-button link size="small" :disabled="si === profile.run.perCase.length - 1"
              @click="moveStep(si, 1)">
              <el-icon>
                <Bottom />
              </el-icon>
            </el-button>
            <el-button link type="danger" size="small" @click="profile.run.perCase.splice(si, 1)">
              <el-icon>
                <Delete />
              </el-icon>
            </el-button>
          </div>

          <!-- exec -->
          <template v-if="s.kind === 'exec'">
            <div class="field-grid">
              <div class="kv"><span class="k">运行产物</span>
                <el-select v-model="s.exec" size="small" filterable allow-create>
                  <el-option v-for="p in execTargets" :key="p" :label="p" :value="p" />
                </el-select>
              </div>
              <div class="kv"><span class="k">标准输入</span>
                <el-select v-model="s.stdin.from" size="small" filterable allow-create>
                  <el-option v-for="r in refOptions" :key="r" :label="r" :value="r" />
                </el-select>
              </div>
              <div class="kv"><span class="k">时间</span>
                <div class="limit-cell">
                  <el-select v-model="s.limits.time" size="small" style="width: 96px;">
                    <el-option label="跟随题目" value="problem" />
                    <el-option label="自定义" :value="1000" />
                  </el-select>
                  <el-input-number v-if="s.limits.time !== 'problem'" v-model="s.limits.time" size="small"
                    :min="1" :max="10000" controls-position="right" style="width: 110px;" />
                  <span class="unit">ms</span>
                </div>
              </div>
              <div class="kv"><span class="k">内存</span>
                <div class="limit-cell">
                  <el-select v-model="s.limits.mem" size="small" style="width: 96px;">
                    <el-option label="跟随题目" value="problem" />
                    <el-option label="自定义" :value="256" />
                  </el-select>
                  <el-input-number v-if="s.limits.mem !== 'problem'" v-model="s.limits.mem" size="small"
                    :min="1" :max="512" controls-position="right" style="width: 110px;" />
                  <span class="unit">MB</span>
                </div>
              </div>
            </div>
          </template>

          <!-- check -->
          <template v-else-if="s.kind === 'check'">
            <div class="kv"><span class="k">校验器</span>
              <el-select v-model="s.checker" size="small" filterable allow-create style="width: 260px;">
                <el-option label="default（内置文本对比）" value="default" />
                <el-option v-for="a in assetNames" :key="a" :label="'asset:' + a + '（testlib checker）'" :value="'asset:' + a" />
                <el-option v-for="p in compileIds" :key="p" :label="p + '（编译产物）'" :value="p" />
              </el-select>
            </div>
            <div class="field-grid check-args">
              <div class="kv"><span class="k">测试点输入</span>
                <el-select v-model="s.args[0]" size="small" filterable allow-create>
                  <el-option v-for="r in refOptions" :key="r" :label="refLabel(r)" :value="r" />
                </el-select>
              </div>
              <div class="kv"><span class="k">要校验的输出</span>
                <el-select v-model="s.args[1]" size="small" filterable allow-create>
                  <el-option v-for="r in refOptions" :key="r" :label="refLabel(r)" :value="r" />
                </el-select>
              </div>
              <div class="kv"><span class="k">标准答案</span>
                <el-select v-model="s.args[2]" size="small" filterable allow-create>
                  <el-option v-for="r in refOptions" :key="r" :label="refLabel(r)" :value="r" />
                </el-select>
              </div>
            </div>
            <div class="sub-label">三个参数依次以 <code>inf usr ans</code> 传给 checker；「要校验的输出」通常选运行步骤的输出</div>
          </template>

          <!-- pipeGroup -->
          <template v-else-if="s.kind === 'pipeGroup'">
            <div class="sub-label">成员进程
              <el-button link type="primary" size="small" @click="addMember(s)">+ 添加成员</el-button>
            </div>
            <div v-for="(m, mi) in s.members" :key="mi" class="member-row">
              <el-input v-model="m.id" size="small" style="width: 110px;" placeholder="成员 id" />
              <span class="k2">运行</span>
              <el-select v-model="m.exec" size="small" filterable allow-create style="width: 130px;">
                <el-option v-for="p in execTargets" :key="p" :label="p" :value="p" />
              </el-select>
              <span class="k2">时限</span>
              <el-select v-model="m.limits.time" size="small" style="width: 100px;">
                <el-option label="跟随题目" value="problem" />
                <el-option label="10s" :value="10000" />
              </el-select>
              <el-button link type="danger" size="small" @click="s.members.splice(mi, 1)">
                <el-icon>
                  <Close />
                </el-icon>
              </el-button>
            </div>
            <div class="sub-label">管道连线（from → to）
              <el-button link type="primary" size="small" @click="addPipe(s)">+ 添加管道</el-button>
            </div>
            <div v-for="(p, pi) in s.pipes" :key="pi" class="src-row">
              <el-select v-model="p.from" size="small" filterable allow-create style="width: 150px;">
                <el-option v-for="o in pipeEndpoints(s)" :key="o" :label="o" :value="o" />
              </el-select>
              <span class="arrow">→</span>
              <el-select v-model="p.to" size="small" filterable allow-create style="width: 150px;">
                <el-option v-for="o in pipeEndpoints(s)" :key="o" :label="o" :value="o" />
              </el-select>
              <el-button link type="danger" size="small" @click="s.pipes.splice(pi, 1)">
                <el-icon>
                  <Close />
                </el-icon>
              </el-button>
            </div>
            <div class="field-grid">
              <div class="kv"><span class="k">裁决来源</span>
                <el-select v-model="s.verdictFrom" size="small">
                  <el-option v-for="m in s.members" :key="m.id" :label="m.id" :value="m.id" />
                </el-select>
              </div>
              <div class="kv"><span class="k">计时归属</span>
                <el-select v-model="s.chargeTimeTo" size="small" multiple collapse-tags collapse-tags-tooltip>
                  <el-option v-for="m in s.members" :key="m.id" :label="m.id" :value="m.id" />
                </el-select>
              </div>
            </div>
          </template>
        </div>
      </section>
    </div>

    <!-- ============ YAML 视图 ============ -->
    <div v-else class="yaml-view">
      <el-alert v-if="yamlError" type="error" :closable="false" :title="'YAML 解析错误：' + yamlError"
        class="yaml-alert" />
      <el-alert v-else type="success" :closable="false" title="YAML 有效，可保存（保存时服务端会再次校验）"
        class="yaml-alert" />
      <monaco-editor v-model:value="yamlText" language="yaml" :height="460" :read-only="!auth.manage"
        @update:value="onYamlInput" />
    </div>

    <!-- 底部未保存提示条 -->
    <transition name="save-slide">
      <div v-if="dirty && auth.manage && !loading" class="save-bar">
        <span class="save-bar-text">评测流程有未保存的改动</span>
        <div class="save-bar-actions">
          <el-button size="small" @click="discardChanges">放弃改动</el-button>
          <el-button type="primary" size="small" :loading="saving"
            :disabled="view === 'yaml' && !!yamlError" @click="save">保存评测流程</el-button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script>
import axios from 'axios';
import jsyaml from 'js-yaml';
import monacoEditor from '@/components/monacoEditor.vue';
import {
  CircleCheck, Plus, Close, Delete, Document, Download, Edit, ArrowDown, Top, Bottom,
  Tickets, Connection, SetUp, ChatLineSquare, Share, Files, InfoFilled,
} from '@element-plus/icons-vue';

const emptyProfile = () => ({
  version: 1, preset: 'traditional',
  submit: { mode: 'code', files: [] },
  assets: [], compile: [], run: { perCase: [] },
});

export default {
  name: 'judgeProfileDesigner',
  components: {
    monacoEditor,
    CircleCheck, Plus, Close, Delete, Document, Download, Edit, ArrowDown, Top, Bottom,
    Tickets, Connection, SetUp, ChatLineSquare, Share, Files, InfoFilled,
  },
  props: {
    pid: { type: [Number, String], required: true },
    auth: { type: Object, default: () => ({ manage: false }) },
  },
  data() {
    return {
      profile: emptyProfile(),
      savedJson: '',
      view: 'visual',
      yamlText: '',
      yamlError: '',
      stored: false,
      loading: false,
      saving: false,
      fixedLangs: ['C', 'C++', 'Python3', 'Java', 'Kotlin', 'Pascal', 'Rust', 'Go', 'Swift', 'Haskell', 'C#', 'F#'],
      // assets
      assets: [],
      activeAsset: null,
      assetContent: '',
      assetSavedContent: '',
      assetSaving: false,
      newAssetName: '',
      quickAssets: ['checker.cpp', 'interactor.cpp', 'manager.cpp', 'grader.cpp'],
      presetCards: [
        { id: 'traditional', label: '传统题', desc: '文本对比', icon: 'Tickets' },
        { id: 'spj', label: 'SPJ 题', desc: '自定义 checker', icon: 'SetUp' },
        { id: 'function', label: '提交函数', desc: 'grader + 头文件', icon: 'Files' },
        { id: 'interactive', label: '交互题', desc: 'interactor 管道', icon: 'Connection' },
        { id: 'communication', label: '通信题', desc: '双进程 + manager', icon: 'Share' },
        { id: 'answer', label: '提交答案', desc: '上传 .out', icon: 'ChatLineSquare' },
      ],
    };
  },
  computed: {
    currentJson() { return JSON.stringify(this.profile); },
    dirty() { return this.currentJson !== this.savedJson; },
    assetDirty() { return this.assetContent !== this.assetSavedContent; },
    assetNames() { return (this.profile.assets || []).map(a => a.name); },
    // 具名的提交文件（可作为编译输入）；留空名的主代码走 auto 编译，不在此列
    submitNames() { return (this.profile.submit.files || []).map(f => f.name).filter(Boolean); },
    // 自定义编译「输入文件」下拉里，选手文件显示成「展示名 (文件名)」更直观
    submitFileOptions() {
      return (this.profile.submit.files || [])
        .filter(f => f.name)
        .map(f => ({ value: f.name, label: f.label ? `${f.label}（${f.name}）` : f.name }));
    },
    compileIds() { return (this.profile.compile || []).map(c => c.id); },
    execTargets() { return this.compileIds; },
    assetLang() {
      const n = this.activeAsset || '';
      if (/\.(cpp|cc|cxx|h|hpp|c)$/i.test(n)) return 'cpp';
      if (/\.py$/i.test(n)) return 'python';
      if (/\.java$/i.test(n)) return 'java';
      if (/\.kt$/i.test(n)) return 'kotlin';
      if (/\.rs$/i.test(n)) return 'rust';
      if (/\.go$/i.test(n)) return 'go';
      if (/\.swift$/i.test(n)) return 'swift';
      if (/\.hs$/i.test(n)) return 'haskell';
      if (/\.cs$/i.test(n)) return 'csharp';
      return 'plaintext';
    },
    // Ref 下拉候选：固定项 + 资产 + 已有步骤输出
    refOptions() {
      const opts = ['case.input', 'case.answer'];
      if (this.profile.submit.mode === 'answer') opts.push('submit.answer');
      for (const a of this.assetNames) opts.push('asset:' + a);
      for (const s of this.profile.run.perCase) {
        if (s.id && s.kind !== 'check') { opts.push('step:' + s.id + '.stdout'); opts.push('step:' + s.id + '.stderr'); }
      }
      return opts;
    },
  },
  methods: {
    presetLabel(preset) {
      return {
        traditional: '传统题', spj: 'SPJ 题', function: '提交函数', interactive: '交互题',
        communication: '通信题', answer: '提交答案', 'answer-spj': '提交答案 SPJ', custom: '自定义',
      }[preset] || preset || '自定义';
    },
    // Ref 的人话标签，下拉里显示「测试点输入 (case.input)」这类格式
    refLabel(ref) {
      const fixed = {
        'case.input': '测试点输入', 'case.answer': '标准答案', 'submit.answer': '选手提交的答案',
      };
      if (fixed[ref]) return `${fixed[ref]}（${ref}）`;
      const m = /^step:([A-Za-z0-9_-]+)\.(stdout|stderr)$/.exec(String(ref || ''));
      if (m) return `步骤 ${m[1]} 的${m[2] === 'stdout' ? '输出' : '错误输出'}（${ref}）`;
      if (String(ref || '').startsWith('asset:')) return `资产 ${String(ref).slice(6)}（${ref}）`;
      return String(ref || '');
    },
    async discardChanges() {
      try { await this.$confirm('放弃所有未保存的改动？', '提示', { type: 'warning' }); }
      catch (e) { return; }
      try {
        this.profile = this.normalize(JSON.parse(this.savedJson));
      } catch (e) {
        await this.load();
        return;
      }
      if (this.view === 'yaml') this.syncToYaml();
    },
    fmtSize(n) {
      if (n == null) return '';
      if (n < 1024) return n + 'B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
      return (n / 1024 / 1024).toFixed(1) + 'MB';
    },
    async load() {
      if (!this.pid || Number(this.pid) <= 0) return;
      this.loading = true;
      try {
        const res = await axios.post('/api/problem/getJudgeProfile', { pid: this.pid });
        if (res.status === 200) {
          this.profile = this.normalize(res.data.data.profile);
          this.savedJson = JSON.stringify(this.profile);
          this.stored = res.data.data.stored;
          this.assets = res.data.data.assets || [];
        } else {
          this.$message.error(res.data.message || '加载失败');
        }
      } catch (e) {
        this.$message.error('加载评测配置失败');
      } finally {
        this.loading = false;
      }
    },
    // 补齐可能缺失的容器字段，避免模板里 undefined.xxx
    normalize(p) {
      const prof = p || emptyProfile();
      prof.submit = prof.submit || { mode: 'code', files: [] };
      prof.submit.files = prof.submit.files || [];
      prof.assets = prof.assets || [];
      prof.compile = prof.compile || [];
      prof.run = prof.run || { perCase: [] };
      prof.run.perCase = prof.run.perCase || [];
      for (const s of prof.run.perCase) {
        if (s.kind === 'exec') {
          if (!s.stdin) s.stdin = { from: 'case.input' };
          if (!s.limits) s.limits = { time: 'problem', mem: 'problem' };
          if (!s.args) s.args = [];
        }
        if (s.kind === 'check') {
          // 固定三槽位 UI（inf / usr / ans），不足时按常见默认补齐
          if (!Array.isArray(s.args)) s.args = [];
          const answerMode = prof.submit.mode === 'answer';
          const defaults = ['case.input', answerMode ? 'submit.answer' : 'case.answer', 'case.answer'];
          for (let i = 0; i < 3; i++) if (s.args[i] == null) s.args[i] = defaults[i];
        }
        if (s.kind === 'pipeGroup') {
          s.members = s.members || [];
          s.pipes = s.pipes || [];
          if (s.chargeTimeTo == null) s.chargeTimeTo = s.verdictFrom ? [s.verdictFrom] : [];
          else if (!Array.isArray(s.chargeTimeTo)) s.chargeTimeTo = [s.chargeTimeTo];
          for (const m of s.members) if (!m.limits) m.limits = { time: 'problem', mem: 'problem' };
        }
      }
      return prof;
    },
    async applyPreset(id) {
      if (this.dirty || this.stored) {
        try {
          await this.$confirm('套用预设会覆盖当前评测流程配置，确认？', '提示', { type: 'warning' });
        } catch (e) { return; }
      }
      try {
        const res = await axios.post('/api/problem/getJudgePreset', { pid: this.pid, preset: id });
        if (res.status === 200) {
          this.profile = this.normalize(res.data.data);
          if (this.view === 'yaml') this.syncToYaml();
          this.$message.success('已套用「' + this.presetLabel(id) + '」预设，确认无误后记得保存');
        } else {
          this.$message.error(res.data.message || '套用失败');
        }
      } catch (e) {
        this.$message.error('套用预设失败');
      }
    },
    onViewChange(v) {
      if (v === 'yaml') this.syncToYaml();
      else this.syncFromYaml(true);
    },
    syncToYaml() {
      try { this.yamlText = jsyaml.safeDump(this.profile, { indent: 2, lineWidth: 100 }); this.yamlError = ''; }
      catch (e) { this.yamlError = e.message; }
    },
    onYamlInput() {
      try { jsyaml.safeLoad(this.yamlText); this.yamlError = ''; }
      catch (e) { this.yamlError = e.message; }
    },
    syncFromYaml(silent) {
      try {
        const obj = jsyaml.safeLoad(this.yamlText);
        if (obj && typeof obj === 'object') { this.profile = this.normalize(obj); this.yamlError = ''; }
      } catch (e) {
        this.yamlError = e.message;
        if (!silent) this.$message.error('YAML 无效，未同步');
      }
    },
    async save() {
      if (this.view === 'yaml') {
        try { this.profile = this.normalize(jsyaml.safeLoad(this.yamlText)); }
        catch (e) { this.$message.error('YAML 无效：' + e.message); return; }
      }
      this.saving = true;
      try {
        const res = await axios.post('/api/problem/saveJudgeProfile', { pid: this.pid, profile: this.profile });
        if (res.status === 200) {
          this.savedJson = JSON.stringify(this.profile);
          this.stored = true;
          this.$message.success('评测流程已保存');
          this.$emit('saved', res.data.typeId);
        } else {
          this.$message.error(res.data.message || '保存失败');
        }
      } catch (e) {
        const msg = e && e.response && e.response.data && e.response.data.message;
        this.$message.error(msg || '保存失败');
      } finally {
        this.saving = false;
      }
    },
    // ---- submit ----
    addSlot() {
      const used = new Set(this.submitNames);
      let n = this.profile.submit.files.length + 1;
      while (used.has(`extra${n}.cpp`)) n++;
      this.profile.submit.files.push({ name: `extra${n}.cpp`, label: '附加文件', kind: 'source', maxKB: 100 });
    },
    // ---- assets ----
    async openAsset(name) {
      if (this.activeAsset === name) return;
      if (this.assetDirty) {
        try { await this.$confirm('当前资产有未保存内容，切换将丢弃，确认？', '提示', { type: 'warning' }); }
        catch (e) { return; }
      }
      this.activeAsset = name;
      this.assetContent = '';
      this.assetSavedContent = '';
      try {
        const res = await axios.post('/api/problem/getAsset', { pid: this.pid, name });
        if (res.status === 200) {
          this.assetContent = res.data.data.content || '';
          this.assetSavedContent = this.assetContent;
        }
      } catch (e) {
        this.$message.error('加载资产失败');
      }
    },
    async saveActiveAsset() {
      this.assetSaving = true;
      try {
        const res = await axios.post('/api/problem/saveAsset', {
          pid: this.pid, name: this.activeAsset, content: this.assetContent,
        });
        if (res.status === 200) {
          this.assetSavedContent = this.assetContent;
          this.$message.success('资产已保存');
          this.refreshAssets();
        } else {
          this.$message.error(res.data.message || '保存失败');
        }
      } catch (e) {
        this.$message.error('保存资产失败');
      } finally {
        this.assetSaving = false;
      }
    },
    async addAsset() {
      const name = (this.newAssetName || '').trim();
      if (!name) return;
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) { this.$message.error('文件名非法'); return; }
      // 注册到 assets[] 元数据 + 落一个空文件，便于立即编辑
      if (!this.assetNames.includes(name)) this.profile.assets.push({ name, role: 'other' });
      try {
        await axios.post('/api/problem/saveAsset', { pid: this.pid, name, content: '' });
        this.newAssetName = '';
        await this.refreshAssets();
        this.openAsset(name);
      } catch (e) {
        this.$message.error('新建资产失败');
      }
    },
    async ensureAsset(name) {
      if (this.assetNames.includes(name)) {
        await this.openAsset(name);
        return;
      }
      this.profile.assets.push({ name, role: 'other' });
      try {
        await axios.post('/api/problem/saveAsset', { pid: this.pid, name, content: '' });
        await this.refreshAssets();
        await this.openAsset(name);
      } catch (e) {
        this.$message.error('创建资产失败');
      }
    },
    async removeAsset(name) {
      try { await this.$confirm('删除资产 ' + name + '？', '提示', { type: 'warning' }); }
      catch (e) { return; }
      try {
        await axios.post('/api/problem/deleteAsset', { pid: this.pid, name });
        const idx = this.profile.assets.findIndex(a => a.name === name);
        if (idx >= 0) this.profile.assets.splice(idx, 1);
        if (this.activeAsset === name) { this.activeAsset = null; this.assetContent = ''; this.assetSavedContent = ''; }
        this.refreshAssets();
      } catch (e) {
        this.$message.error('删除失败');
      }
    },
    async renameAsset(name) {
      let result;
      try {
        result = await this.$prompt('请输入新的资产文件名', '重命名资产', {
          inputValue: name,
          inputPattern: /^[A-Za-z0-9._-]{1,64}$/,
          inputErrorMessage: '文件名只能包含字母、数字、点、下划线和短横线',
        });
      } catch (e) {
        return;
      }
      const newName = (result.value || '').trim();
      if (!newName || newName === name) return;
      try {
        const res = await axios.post('/api/problem/renameAsset', { pid: this.pid, oldName: name, newName });
        if (res.status === 200) {
          const shouldReopen = this.activeAsset === name;
          if (shouldReopen) this.activeAsset = null;
          this.$message.success('资产已重命名');
          await this.load();
          if (shouldReopen) await this.openAsset(newName);
        } else {
          this.$message.error(res.data.message || '重命名失败');
        }
      } catch (e) {
        this.$message.error('重命名失败');
      }
    },
    async downloadAsset(name) {
      try {
        const res = await axios.post('/api/problem/createFileAccess', {
          pid: this.pid,
          action: 'downloadAsset',
          name,
        });
        if (res.status === 200 && res.data && res.data.url) {
          window.location.href = res.data.url;
        } else {
          this.$message.error((res.data && res.data.message) || '下载失败');
        }
      } catch (e) {
        this.$message.error('下载失败');
      }
    },
    async refreshAssets() {
      try {
        const res = await axios.post('/api/problem/listAssets', { pid: this.pid });
        if (res.status === 200) this.assets = res.data.data || [];
      } catch (e) { /* ignore */ }
    },
    // ---- compile ----
    addCompile() {
      // 默认 auto：编译选手主代码，最常见；需要 grader 时切到自定义即可。
      this.profile.compile.push({ id: 'prog' + (this.profile.compile.length + 1), command: 'auto', inputs: [] });
    },
    setCompileMode(c, mode) {
      if (mode === 'auto') {
        c.command = 'auto';
        c.inputs = [];
      } else {
        // 自定义：默认带上具名提交文件 + 资产作为输入，命令给个 g++ 起手式
        const inputs = [...this.submitNames, ...this.assetNames];
        c.inputs = inputs.length ? inputs : [];
        c.command = ['/usr/bin/g++-9', '-O2', '-std=c++14', ...(c.inputs.length ? [c.inputs[0]] : []), '-o', c.id || 'prog'];
      }
    },
    cmdText(c) { return Array.isArray(c.command) ? c.command.join('\n') : ''; },
    setCmdText(c, text) { c.command = text.split('\n').map(s => s.trim()).filter(Boolean); },
    // ---- run ----
    stepLabel(kind) { return { exec: '运行', check: '裁决', pipeGroup: '管道组' }[kind] || kind; },
    defaultExecTarget(index = 0, fallback = 'main') {
      return this.execTargets[index] || this.execTargets[0] || fallback;
    },
    addRunStep(kind) {
      const n = this.profile.run.perCase.length + 1;
      if (kind === 'exec') {
        this.profile.run.perCase.push({
          id: 'run' + n, kind: 'exec', exec: this.defaultExecTarget(), args: [],
          stdin: { from: 'case.input' }, limits: { time: 'problem', mem: 'problem' }, capture: ['stdout'],
        });
      } else if (kind === 'check') {
        const lastRun = [...this.profile.run.perCase].reverse().find(s => s.kind !== 'check' && s.id);
        this.profile.run.perCase.push({
          id: 'check' + n, kind: 'check', checker: 'default',
          args: ['case.input', `step:${lastRun ? lastRun.id : 'run1'}.stdout`, 'case.answer'],
        });
      } else {
        this.profile.run.perCase.push({
          id: 'group' + n, kind: 'pipeGroup',
          members: [
            { id: 'sol', exec: this.defaultExecTarget(0, 'main'), args: [], limits: { time: 'problem', mem: 'problem' } },
            { id: 'itc', exec: this.defaultExecTarget(1, 'interactor'), args: ['case.input', 'case.answer'], limits: { time: 10000, mem: 512 } },
          ],
          pipes: [
            { from: 'sol.stdout', to: 'itc.stdin' },
            { from: 'itc.stdout', to: 'sol.stdin' },
          ],
          verdictFrom: 'itc', chargeTimeTo: ['sol'],
        });
      }
    },
    moveStep(i, dir) {
      const arr = this.profile.run.perCase;
      const j = i + dir;
      if (j < 0 || j >= arr.length) return;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    },
    addMember(s) {
      s.members.push({ id: 'm' + (s.members.length + 1), exec: this.defaultExecTarget(), args: [], limits: { time: 'problem', mem: 'problem' } });
    },
    addPipe(s) { s.pipes.push({ from: '', to: '' }); },
    pipeEndpoints(s) {
      const out = [];
      for (const m of s.members) { out.push(m.id + '.stdin'); out.push(m.id + '.stdout'); out.push(m.id + '.stderr'); }
      return out;
    },
  },
  watch: {
    // The designer mounts before the parent's mounted() sets pid, so load on a
    // pid watcher (immediate) and guard against the initial pid=0 — otherwise
    // getJudgeProfile gets pid=0 → 403 → "加载评测配置失败" on every refresh.
    pid: {
      immediate: true,
      handler(v) { if (v && Number(v) > 0) this.load(); },
    },
    profile: {
      deep: true,
      handler() { if (this.view === 'yaml') this.syncToYaml(); },
    },
  },
};
</script>

<style scoped>
.designer {
  text-align: left;
}

.current-type {
  display: flex;
  align-items: center;
  gap: 10px;
}

.current-type-label {
  font-size: 13px;
  font-weight: 700;
  color: #606266;
}

.block-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
  font-size: 16px;
  font-weight: 700;
  color: #409eff;
}

.preset-check {
  margin-left: 4px;
  color: #409eff;
  font-size: 16px;
}

.check-args .kv .k {
  width: 92px;
}

.save-bar {
  position: sticky;
  bottom: 12px;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding: 10px 16px;
  border: 1px solid #f3d19e;
  border-radius: 10px;
  background: #fdf6ec;
  box-shadow: 0 6px 18px rgba(230, 162, 60, 0.18);
}

.save-bar-text {
  font-size: 13px;
  font-weight: 600;
  color: #b88230;
}

.save-bar-actions {
  display: flex;
  gap: 8px;
}

.save-slide-enter-active,
.save-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.save-slide-enter-from,
.save-slide-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
}

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.preset-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  cursor: pointer;
  background: #fff;
  transition: all 0.15s;
}

.preset-card:hover {
  border-color: #c6e2ff;
  background: #f5f9ff;
}

.preset-card.active {
  border-color: #409eff;
  background: #ecf5ff;
}

.preset-icon {
  font-size: 20px;
  color: #409eff;
}

.preset-label {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.preset-desc {
  font-size: 11px;
  color: #909399;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.block {
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 14px;
  background: #fff;
}

.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.block-title {
  font-size: 16px;
  font-weight: 700;
  color: #303133;
}

.block-sub {
  margin-left: 10px;
  font-size: 12px;
  color: #909399;
}

.slot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.slot-card {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  padding: 10px;
  background: #fafafa;
}

.slot-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.slot-idx {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
}

.slot-primary {
  margin-left: 6px;
  padding: 0 6px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: #409eff;
  border-radius: 8px;
}

.kv {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.kv .k {
  width: 78px;
  flex-shrink: 0;
  font-size: 12px;
  color: #606266;
}

.asset-add {
  display: flex;
  align-items: center;
}

.asset-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 12px;
}

.asset-list {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  padding: 6px;
  min-height: 120px;
  max-height: 360px;
  overflow: auto;
}

.asset-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.asset-item:hover {
  background: #f5f7fa;
}

.asset-item.active {
  background: #ecf5ff;
}

.asset-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-size {
  font-size: 11px;
  color: #c0c4cc;
}

.asset-editor {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  overflow: hidden;
}

.asset-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 160px;
  color: #c0c4cc;
  font-size: 14px;
}

.asset-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #fafafa;
  border-bottom: 1px solid #f0f0f0;
  font-weight: 600;
  font-size: 13px;
}

.step-card {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 10px;
  background: #fcfcfc;
}

.step-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.step-badge {
  font-size: 12px;
  font-weight: 700;
  padding: 2px 9px;
  border-radius: 10px;
  color: #fff;
}

.step-compile {
  background: #909399;
}

.step-exec {
  background: #409eff;
}

.step-check {
  background: #67c23a;
}

.step-pipeGroup {
  background: #e6a23c;
}

.arrow {
  color: #c0c4cc;
  font-weight: 700;
}

.grow {
  flex: 1;
}

.sub-label {
  font-size: 12px;
  color: #909399;
  margin: 8px 0 6px;
}

.src-row,
.member-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.k2 {
  font-size: 12px;
  color: #909399;
}

.hint {
  font-size: 12px;
  color: #c0c4cc;
}

.auto-note {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: #f4f9ff;
  border: 1px solid #d9ecff;
  border-radius: 6px;
  font-size: 12px;
  color: #5a7ea6;
}

.auto-note .el-icon {
  color: #409eff;
}

.cmd-input {
  width: 100%;
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.sub-label code {
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: #f0f2f5;
  padding: 1px 5px;
  border-radius: 3px;
  color: #d63384;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px 16px;
}

.limit-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.unit {
  font-size: 12px;
  color: #909399;
}

.yaml-view {
  border: 1px solid #ebeef5;
  border-radius: 10px;
  overflow: hidden;
}

.yaml-alert {
  border-radius: 0;
}

.ml8 {
  margin-left: 8px;
}

.mr8 {
  margin-right: 8px;
}

@media (max-width: 980px) {
  .asset-layout {
    grid-template-columns: 1fr;
  }

  .save-bar {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
