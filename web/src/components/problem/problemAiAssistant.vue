<template>
  <main class="ai-page">
    <section class="ai-header">
      <div>
        <div class="eyebrow">Problem #{{ problemNumber }}</div>
        <h1>LLM 出题助手</h1>
        <div class="subline">{{ problemInfo.title || '未命名题目' }}</div>
      </div>
      <div class="header-actions">
        <el-button plain @click="this.$router.push('/problem/edit/' + pid)">
          <el-icon class="el-icon--left"><Back /></el-icon>
          编辑题面
        </el-button>
        <el-button plain @click="this.$router.push('/problem/case/' + pid)">
          <el-icon class="el-icon--left"><SetUp /></el-icon>
          管理数据
        </el-button>
      </div>
    </section>

    <section class="config-band">
      <el-form label-position="top" class="config-form">
        <el-form-item label="Base URL">
          <el-input v-model="llm.baseUrl" placeholder="https://api.openai.com/v1" />
        </el-form-item>
        <el-form-item label="API Key">
          <el-input
            v-model="llm.apiKeyInput"
            type="password"
            show-password
            :placeholder="llm.hasKey ? `已保存：${llm.keyPreview}` : '粘贴你自己的 Key'"
            autocomplete="off"
          />
        </el-form-item>
        <el-form-item label="模型">
          <div class="model-row">
            <el-autocomplete
              v-model="llm.model"
              :fetch-suggestions="queryModelSuggestions"
              placeholder="选择模型或直接输入模型名"
              clearable
            />
            <el-button plain :loading="llm.modelsLoading" @click="loadModels">
              <el-icon class="el-icon--left"><Refresh /></el-icon>
              读取模型
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label=" ">
          <el-button type="primary" :loading="llm.saving" @click="saveConfig">
            <el-icon class="el-icon--left"><CircleCheck /></el-icon>
            保存配置
          </el-button>
        </el-form-item>
      </el-form>
    </section>

    <section class="guide-band">
      <div class="guide-head">
        <div>
          <h2>使用指南</h2>
          <p>像和同事协作一样：先说需求生成草稿，再多轮小步修改，每轮 AI 自动编译自检。</p>
        </div>
      </div>
      <div class="guide-grid">
        <div class="guide-item">
          <span>1</span>
          <div>
            <strong>配置模型</strong>
            <p>保存 Base URL、API Key 和模型名，后续生成使用个人配置。</p>
          </div>
        </div>
        <div class="guide-item">
          <span>2</span>
          <div>
            <strong>对话式出题</strong>
            <p>首轮描述题目；之后直接说要改什么，AI 只更新需要变的部分。</p>
          </div>
        </div>
        <div class="guide-item">
          <span>3</span>
          <div>
            <strong>自动自检</strong>
            <p>生成后在沙箱真实编译 STD/生成器/评测资产并试造数据，失败自动修复。</p>
          </div>
        </div>
        <div class="guide-item">
          <span>4</span>
          <div>
            <strong>逐项保存</strong>
            <p>评测资产、测试数据、题解草稿和题面分别保存，便于回滚。</p>
          </div>
        </div>
      </div>
    </section>

    <section class="prompt-band">
      <div class="section-line">
        <div>
          <h2>和 AI 一起出题</h2>
          <p>{{ hasDraft ? '已有草稿：直接说要改什么，AI 只会更新需要变的部分，其余原样保留。' : '描述你想要的题目，AI 会生成草稿并在沙箱里自动编译、试造数据。' }}</p>
        </div>
        <el-checkbox-group v-model="sections" class="section-picker">
          <el-checkbox-button label="statement" value="statement">题面</el-checkbox-button>
          <el-checkbox-button label="std" value="std">STD</el-checkbox-button>
          <el-checkbox-button label="solution" value="solution">题解</el-checkbox-button>
          <el-checkbox-button label="data" value="data">数据</el-checkbox-button>
          <el-checkbox-button label="judge" value="judge">评测</el-checkbox-button>
        </el-checkbox-group>
      </div>

      <div v-if="chat.length" class="chat-list">
        <div v-for="turn in chat" :key="turn.key" class="chat-turn" :class="turn.role === 'user' ? 'chat-user' : 'chat-assistant'">
          <div class="chat-bubble" :class="{ 'chat-warn': turn.status === 'error' || turn.status === 'done_with_warning' }">
            <div class="chat-text">{{ turn.text }}</div>
            <div v-if="turn.role === 'assistant' && ((turn.sections && turn.sections.length) || turn.checkFails)" class="chat-meta">
              <el-tag v-for="s in turn.sections || []" :key="s" size="small" effect="plain">已更新：{{ sectionLabel(s) }}</el-tag>
              <el-tag v-if="turn.checkFails" size="small" type="warning" effect="plain">自检 {{ turn.checkFails }} 项未通过</el-tag>
            </div>
          </div>
        </div>
        <div class="chat-tools">
          <el-button link size="small" @click="clearChat">清空对话记录</el-button>
        </div>
      </div>

      <div v-if="quickActions.length" class="quick-row">
        <span class="quick-hint">试试：</span>
        <el-tag
          v-for="qa in quickActions"
          :key="qa.label"
          class="quick-chip"
          effect="plain"
          @click="applyQuickAction(qa)"
        >{{ qa.label }}</el-tag>
      </div>

      <el-input
        v-model="prompt"
        type="textarea"
        :autosize="{ minRows: 4, maxRows: 10 }"
        maxlength="12000"
        show-word-limit
        :placeholder="hasDraft ? '例：把 n 的上限提高到 1e6，并同步加强数据 / 题面样例再加一组 / 自检失败的地方修一下' : '描述你想要的题目：题型、难度、考察点、数据范围，越具体越好。'"
        @keydown.enter.meta.prevent="generateDraft"
        @keydown.enter.ctrl.prevent="generateDraft"
      />
      <div class="generate-row">
        <span class="send-hint">Ctrl/⌘ + Enter 发送</span>
        <el-button type="primary" size="large" :loading="loading" :disabled="loading" @click="generateDraft">
          <el-icon class="el-icon--left"><DataAnalysis /></el-icon>
          {{ loading ? '生成中' : (hasDraft ? '发送修改要求' : '生成草稿') }}
        </el-button>
        <el-button v-if="generationActive" size="large" type="danger" plain :loading="generationStopping" @click="cancelGeneration">
          停止生成
        </el-button>
        <el-button size="large" plain :disabled="loading || !hasDraft" @click="resetDraft">清空草稿</el-button>
      </div>
    </section>

    <section v-if="loading || stream.jobId || stream.status || stream.error" class="stream-band">
      <div class="stream-head">
        <div>
          <h2>AI 配置过程</h2>
          <p>{{ stream.status || '等待后台任务状态...' }}</p>
        </div>
        <el-tag v-if="stream.state === 'error'" type="danger">失败</el-tag>
        <el-tag v-else-if="stream.state === 'done_with_warning'" type="warning">已恢复</el-tag>
        <el-tag v-else-if="stream.state === 'cancelled'" type="info">已停止</el-tag>
        <el-tag v-else-if="stream.done" type="success">完成</el-tag>
        <el-tag v-else-if="loading" type="warning">正在配置</el-tag>
        <el-tag v-else type="info">已停止</el-tag>
      </div>
      <el-alert v-if="stream.error" type="error" :closable="false" :title="stream.error" show-icon />
      <el-alert v-if="stream.warning" type="warning" :closable="false" :title="stream.warning" show-icon />

      <div class="progress-grid">
        <!-- 左：模型自己的操作计划 -->
        <div class="plan-box">
          <div class="editor-label">出题计划</div>
          <div v-if="!stream.plan.length" class="plan-waiting">
            <el-icon class="is-loading" v-if="loading"><Loading /></el-icon>
            {{ loading ? '正在拟定出题计划…' : '本次任务没有返回计划' }}
          </div>
          <transition-group v-else name="plan-pop" tag="div" class="plan-list">
            <div v-for="(p, i) in stream.plan" :key="p" class="plan-item" :class="{ 'is-done': planItemDone(i) }">
              <el-icon v-if="planItemDone(i)" class="plan-icon ok"><CircleCheck /></el-icon>
              <el-icon v-else-if="loading" class="plan-icon is-loading"><Loading /></el-icon>
              <span v-else class="plan-icon dot">○</span>
              <span class="plan-text">{{ p }}</span>
            </div>
          </transition-group>
        </div>

        <!-- 右：各部分的生成状态（点击已生成的部分直接跳到对应 Tab） -->
        <div class="section-progress">
          <div class="editor-label">生成进度</div>
          <div v-for="s in sectionProgress" :key="s.key" class="sp-item" :class="'sp-' + s.state"
            @click="s.state !== 'pending' && jumpToSection(s.key)">
            <span class="sp-icon">
              <el-icon v-if="s.state === 'done'"><CircleCheck /></el-icon>
              <el-icon v-else-if="s.state === 'writing'" class="is-loading"><Loading /></el-icon>
              <span v-else class="sp-dot">○</span>
            </span>
            <span class="sp-label">{{ s.label }}</span>
            <span class="sp-summary">{{ s.summary }}</span>
          </div>
        </div>
      </div>

      <div v-if="stream.checks.length" class="checks-box">
        <div class="checks-head">
          <div class="editor-label">自检报告（沙箱真实编译 + 试造数据）</div>
          <el-tag v-if="stream.repairRound" size="small" type="info" effect="plain">已自动修复 {{ stream.repairRound }} 轮</el-tag>
        </div>
        <div v-for="c in stream.checks" :key="c.id" class="check-item" :class="'check-' + c.status">
          <span class="check-icon">
            <el-icon v-if="c.status === 'pass'"><CircleCheck /></el-icon>
            <el-icon v-else-if="c.status === 'fail'"><CircleClose /></el-icon>
            <span v-else>—</span>
          </span>
          <span class="check-label">{{ c.label }}</span>
          <span v-if="c.detail" class="check-detail" :title="c.detail">{{ c.detail }}</span>
        </div>
      </div>

      <el-collapse v-if="stream.reasoning" class="reasoning-collapse">
        <el-collapse-item title="模型思考过程" name="reasoning">
          <pre class="reasoning-pre">{{ stream.reasoning }}</pre>
        </el-collapse-item>
      </el-collapse>
    </section>

    <section class="draft-band">
      <el-empty v-if="!hasDraft" description="暂无草稿" :image-size="90" />
      <el-tabs v-else v-model="activeTab">
        <el-tab-pane label="题面" name="statement">
          <div class="tab-actions">
            <el-button type="primary" plain :loading="savingStatement" @click="saveStatement">
              <el-icon class="el-icon--left"><CircleCheck /></el-icon>
              保存到题目
            </el-button>
          </div>
          <div class="statement-grid">
            <el-form-item label="标题">
              <el-input v-model="draft.statement.title" maxlength="100" />
            </el-form-item>
            <el-form-item label="标签">
              <el-select v-model="draft.statement.tags" multiple filterable allow-create default-first-option>
                <el-option v-for="tag in draft.statement.tags" :key="tag" :label="tag" :value="tag" />
              </el-select>
            </el-form-item>
            <el-form-item label="时间限制">
              <el-input-number v-model="draft.statement.timeLimit" :min="1" :max="60000" />
            </el-form-item>
            <el-form-item label="空间限制">
              <el-input-number v-model="draft.statement.memoryLimit" :min="1" :max="4096" />
            </el-form-item>
            <el-form-item label="难度">
              <el-select v-model="draft.statement.level">
                <el-option v-for="item in levels" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
          </div>
          <div class="editor-label">题面 Markdown</div>
          <v-md-editor height="390px" v-model="draft.statement.description"></v-md-editor>
          <div class="editor-label">样例</div>
          <div class="sample-list">
            <div v-for="(sample, index) in draft.statement.samples" :key="sample.key" class="sample-block">
              <div class="block-head">
                <strong>样例 #{{ index + 1 }}</strong>
                <el-button link type="danger" @click="removeSample(index)">删除</el-button>
              </div>
              <div class="two-cols">
                <el-input type="textarea" v-model="sample.inputData" :autosize="{ minRows: 4, maxRows: 10 }" placeholder="输入" />
                <el-input type="textarea" v-model="sample.outputData" :autosize="{ minRows: 4, maxRows: 10 }" placeholder="输出" />
              </div>
            </div>
            <el-button plain @click="addSample">
              <el-icon class="el-icon--left"><CirclePlus /></el-icon>
              新增样例
            </el-button>
          </div>
        </el-tab-pane>

        <el-tab-pane label="STD" name="std">
          <div class="tab-actions">
            <el-input v-model="draft.std.fileName" class="file-input" placeholder="std.cpp" />
            <el-button type="primary" plain :loading="savingStd" @click="saveStd">
              <el-icon class="el-icon--left"><CircleCheck /></el-icon>
              保存为资产
            </el-button>
          </div>
          <monaco-editor v-model:value="draft.std.source" :language="stdLanguage" :height="520" :font-size="14" />
        </el-tab-pane>

        <el-tab-pane label="题解" name="solution">
          <div class="tab-actions">
            <el-input v-model="draft.solution.title" class="file-input" maxlength="20" placeholder="题解标题" />
            <el-button type="primary" plain :loading="savingSolution" @click="saveSolution">
              <el-icon class="el-icon--left"><DocumentAdd /></el-icon>
              创建题解草稿
            </el-button>
            <el-button v-if="solutionMark" plain @click="this.$router.push('/paste/edit/' + solutionMark)">打开草稿</el-button>
          </div>
          <v-md-editor height="560px" v-model="draft.solution.markdown"></v-md-editor>
        </el-tab-pane>

        <el-tab-pane label="数据" name="data">
          <div class="tab-actions">
            <el-button plain :loading="previewingData" @click="previewData">
              <el-icon class="el-icon--left"><View /></el-icon>
              运行预览
            </el-button>
            <el-button type="primary" plain :loading="savingData" @click="saveData">
              <el-icon class="el-icon--left"><CircleCheck /></el-icon>
              保存测试数据
            </el-button>
            <el-button plain @click="addGenerationCase">
              <el-icon class="el-icon--left"><CirclePlus /></el-icon>
              新增生成点
            </el-button>
            <el-button plain @click="addCase">
              <el-icon class="el-icon--left"><CirclePlus /></el-icon>
              新增静态 Case
            </el-button>
          </div>
          <div class="editor-label">在线生成计划</div>
          <div class="case-list">
            <div v-for="(item, index) in draft.data.generation.cases" :key="item.key" class="case-block">
              <div class="block-head">
                <el-input v-model="item.name" class="case-name" placeholder="case 名称" />
                <el-input-number v-model="item.subtaskId" :min="1" :max="100" />
                <el-input v-model="item.argsText" class="case-args" placeholder="生成参数 / seed / 特殊性质" />
                <el-button link type="danger" @click="removeGenerationCase(index)">删除</el-button>
              </div>
              <el-input type="textarea" v-model="item.note" :autosize="{ minRows: 2, maxRows: 5 }" placeholder="备注" />
            </div>
          </div>
          <div class="editor-label">静态 Case</div>
          <div class="case-list">
            <div v-for="(item, index) in draft.data.cases" :key="item.key" class="case-block">
              <div class="block-head">
                <el-input v-model="item.name" class="case-name" placeholder="case 名称" />
                <el-input-number v-model="item.subtaskId" :min="1" :max="100" />
                <el-button link type="danger" @click="removeCase(index)">删除</el-button>
              </div>
              <div class="two-cols">
                <el-input type="textarea" v-model="item.input" :autosize="{ minRows: 5, maxRows: 12 }" placeholder="输入数据" />
                <el-input type="textarea" v-model="item.output" :autosize="{ minRows: 5, maxRows: 12 }" placeholder="输出数据" />
              </div>
            </div>
          </div>
          <div class="editor-label">造数据程序</div>
          <div class="tab-actions">
            <el-input v-model="draft.data.generator.fileName" class="file-input" placeholder="ai-generator.cpp" />
          </div>
          <monaco-editor v-model:value="draft.data.generator.source" :language="generatorLanguage" :height="300" :font-size="14" />
          <div class="editor-label">备注</div>
          <el-input type="textarea" v-model="draft.data.notes" :autosize="{ minRows: 3, maxRows: 8 }" />
          <div v-if="dataPreview.cases.length" class="data-preview-panel">
            <div class="preview-head">
              <strong>运行预览</strong>
              <div class="preview-tags">
                <el-tag type="success" effect="plain">{{ dataPreview.cases.length }} 个测试点</el-tag>
                <el-tag effect="plain">总量 {{ formatBytes(dataPreview.totalBytes) }}</el-tag>
              </div>
            </div>
            <el-table :data="dataPreview.cases" border>
              <el-table-column label="#" prop="index" width="70" align="center" />
              <el-table-column label="名称" prop="name" min-width="130" />
              <el-table-column label="子任务" prop="subtaskId" width="90" align="center" />
              <el-table-column label="输入预览" min-width="260">
                <template #default="scope">
                  <div class="preview-meta">{{ formatBytes(scope.row.input.bytes) }}</div>
                  <pre>{{ scope.row.input.content }}</pre>
                </template>
              </el-table-column>
              <el-table-column label="输出预览" min-width="260">
                <template #default="scope">
                  <div class="preview-meta">{{ formatBytes(scope.row.output.bytes) }}</div>
                  <pre>{{ scope.row.output.content }}</pre>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane label="评测" name="judge">
          <div class="tab-actions">
            <el-select v-model="draft.judge.preset" class="preset-select" placeholder="评测预设">
              <el-option v-for="preset in judgePresets" :key="preset.value" :label="preset.label" :value="preset.value" />
            </el-select>
            <el-button plain :loading="loadingJudgePreset" @click="loadJudgePreset">
              <el-icon class="el-icon--left"><Refresh /></el-icon>
              套用预设
            </el-button>
            <el-button type="primary" plain :loading="savingJudge" @click="saveJudge">
              <el-icon class="el-icon--left"><CircleCheck /></el-icon>
              保存评测配置
            </el-button>
          </div>
          <div class="judge-grid">
            <div>
              <div class="editor-label">judgeProfile JSON</div>
              <el-input
                v-model="judgeProfileText"
                type="textarea"
                class="profile-json"
                :autosize="{ minRows: 18, maxRows: 36 }"
              />
              <div class="editor-label">nywoj.yaml</div>
              <el-alert
                v-if="judgeYamlError"
                type="error"
                :closable="false"
                :title="'YAML 解析错误：' + judgeYamlError"
                class="yaml-alert"
              />
              <el-input
                v-model="judgeYamlText"
                type="textarea"
                class="profile-json"
                :autosize="{ minRows: 14, maxRows: 32 }"
                @input="onJudgeYamlInput"
              />
            </div>
            <div>
              <div class="asset-title-row">
                <div class="editor-label">资产文件</div>
                <el-button plain @click="addJudgeAsset">
                  <el-icon class="el-icon--left"><CirclePlus /></el-icon>
                  新增资产
                </el-button>
              </div>
              <el-empty v-if="!draft.judge.assets.length" description="暂无资产" :image-size="70" />
              <div v-else class="asset-list">
                <div v-for="(asset, index) in draft.judge.assets" :key="asset.key" class="asset-block">
                  <div class="block-head">
                    <el-input v-model="asset.name" class="asset-name" placeholder="checker.cpp" />
                    <el-select v-model="asset.role" class="asset-role" filterable allow-create default-first-option>
                      <el-option label="checker" value="checker" />
                      <el-option label="interactor" value="interactor" />
                      <el-option label="manager" value="manager" />
                      <el-option label="grader" value="grader" />
                      <el-option label="header" value="header" />
                    </el-select>
                    <el-input v-model="asset.language" class="asset-lang" placeholder="cpp" />
                    <el-button link type="danger" @click="removeJudgeAsset(index)">删除</el-button>
                  </div>
                  <monaco-editor v-model:value="asset.content" :language="judgeAssetLanguage(asset)" :height="300" :font-size="14" />
                </div>
              </div>
            </div>
          </div>
          <div class="editor-label">备注</div>
          <el-input type="textarea" v-model="draft.judge.notes" :autosize="{ minRows: 3, maxRows: 8 }" />
        </el-tab-pane>
      </el-tabs>
    </section>
  </main>
</template>

<script>
import axios from 'axios';
import jsyaml from 'js-yaml';
import { ElMessageBox } from 'element-plus';
import monacoEditor from '@/components/monacoEditor.vue';

const MAX_STATIC_CASE_FILE_BYTES = 16 * 1024 * 1024;
const CONTEXT_CASE_PREVIEW_CHARS = 2048;

export default {
  name: 'problemAiAssistant',
  components: { monacoEditor },
  data() {
    return {
      pid: 0,
      auth: {},
      problemInfo: {},
      llm: {
        baseUrl: 'https://api.openai.com/v1',
        apiKeyInput: '',
        hasKey: false,
        keyPreview: '',
        model: '',
        models: [],
        modelsLoading: false,
        saving: false,
      },
      sections: ['statement', 'std', 'solution', 'data', 'judge'],
      prompt: '',
      promptHistory: [],
      chat: [],
      activeTab: 'statement',
      loading: false,
      savingStatement: false,
      savingStd: false,
      savingSolution: false,
      savingData: false,
      previewingData: false,
      savingJudge: false,
      loadingJudgePreset: false,
      generationStopping: false,
      dataPreview: { cases: [], totalBytes: 0, sandboxGenerated: false },
      judgeProfileText: '',
      judgeYamlText: '',
      judgeYamlError: '',
      lastSyncedJudgeProfileText: '',
      lastSyncedJudgeYamlText: '',
      stream: {
        jobId: '',
        reasoning: '',
        status: '',
        state: '',
        error: '',
        warning: '',
        done: false,
        plan: [],
        parsedSections: [],
        startedSections: [],
        summary: '',
        checks: [],
        repairRound: 0,
      },
      generationSource: null,
      generationPollTimer: null,
      generationDoneAnnounced: false,
      lastAutoTab: '',
      solutionMark: '',
      draft: null,
      judgePresets: [
        { value: 'traditional', label: '传统题' },
        { value: 'spj', label: 'SPJ' },
        { value: 'answer', label: '提交答案' },
        { value: 'answer-spj', label: '提交答案 SPJ' },
        { value: 'function', label: '函数题' },
        { value: 'interactive', label: '交互题' },
        { value: 'communication', label: '通信题' },
        { value: 'custom', label: '自定义' },
      ],
      levels: [
        { value: 0, label: '暂未评级' },
        { value: 1, label: '入门' },
        { value: 2, label: '普及' },
        { value: 3, label: '提高' },
        { value: 4, label: '省选' },
        { value: 5, label: 'NOI / NOI+' },
      ],
    };
  },
  computed: {
    problemNumber() {
      return this.problemInfo.pid || this.pid;
    },
    hasDraft() {
      const draft = this.draft;
      if (!draft) return false;
      const judgeChanged = !!(draft.judge && (
        draft.judge.notes ||
        draft.judge.yaml ||
        (draft.judge.assets || []).some(asset => asset.content || asset.name !== 'checker.cpp') ||
        JSON.stringify(draft.judge.profile || {}) !== JSON.stringify(this.traditionalJudgeProfile())
      ));
      return !!(draft.statement.description || draft.std.source || draft.solution.markdown ||
        (draft.data.cases && draft.data.cases.length) ||
        (draft.data.generation && draft.data.generation.cases && draft.data.generation.cases.length) ||
        draft.data.generator.source || judgeChanged);
    },
    stdLanguage() {
      return this.editorLanguageOf(this.draft.std.language || this.draft.std.fileName);
    },
    generatorLanguage() {
      return this.editorLanguageOf(this.draft.data.generator.language || this.draft.data.generator.fileName);
    },
    // 各部分的生成状态卡：pending → writing → done；增量修改时模型可能只更新
    // 一部分，结束后未输出的部分标记为「未改动」。
    sectionProgress() {
      const labels = { statement: '题面', std: '标准程序', solution: '题解', data: '测试数据', judge: '评测配置' };
      const parsed = new Set(this.stream.parsedSections || []);
      const started = new Set(this.stream.startedSections || []);
      return this.sections.map((key) => {
        let state = 'pending';
        let summary = '等待';
        if (parsed.has(key)) {
          state = 'done';
          summary = this.sectionSummary(key);
        } else if (started.has(key)) {
          state = 'writing';
          summary = '撰写中…';
        } else if (this.stream.done && this.stream.state !== 'error') {
          state = 'kept';
          summary = '未改动';
        }
        return { key, label: labels[key] || key, state, summary };
      });
    },
    generationActive() {
      return this.isGenerationActive(this.stream.state);
    },
    // 有草稿后给出的快捷修改指令；有自检失败项时置顶「修复自检问题」。
    quickActions() {
      if (this.loading) return [];
      const actions = [];
      const fails = (this.stream.checks || []).filter(c => c.status === 'fail').length;
      if (this.hasDraft && fails) {
        actions.push({ label: `修复自检问题（${fails} 项）`, prompt: '自检报告里还有失败项，请逐条修复。不要为了绕过检查删功能，要修根因。', send: true });
      }
      if (this.hasDraft) {
        actions.push(
          { label: '加强测试数据', prompt: '在保持题意不变的前提下加强测试数据：补齐边界点、特殊结构点和极限点，必要时更新生成器。' },
          { label: '润色题面', prompt: '润色题面表述：格式规范、约束完整、样例配解释，不改变题意。' },
          { label: '完善题解', prompt: '完善题解：补充做法的正确性说明和复杂度分析，必要时给实现要点。' },
        );
      } else {
        actions.push(
          { label: '例：传统题', prompt: '出一道提高组难度的传统题，考察二分答案 + 贪心检查，n ≤ 2×10^5。生成完整题面、std、题解、数据和评测配置。' },
          { label: '例：SPJ 题', prompt: '出一道答案不唯一、需要 testlib SPJ 的构造题，普及+难度。' },
          { label: '例：提交答案', prompt: '出一道提交答案题：给 5 个固定测试点，选手只提交答案文件。必须使用静态 data.cases，不要生成器，默认逐字节比较。' },
          { label: '例：提交答案 SPJ', prompt: '出一道提交答案 + SPJ 题：选手提交一个合法构造，checker.cpp 用 testlib 验证合法性并按质量给部分分。使用 4 个静态测试点。' },
          { label: '例：函数题', prompt: '出一道函数题：选手实现 solution.h 中的函数，提供 problem.h 和 grader.cpp。生成完整题面、std、题解、生成器和 function 评测配置。' },
          { label: '例：交互题', prompt: '出一道交互题：猜数字，最多 20 次询问，需要 testlib interactor。写清交互协议、flush 要求和退出条件。' },
          { label: '例：通信题', prompt: '出一道通信题：同一份 sol.cpp 用 -DSIDE_A/-DSIDE_B 编译两个角色，manager.cpp 负责通信和裁判。写清通信限制。' },
        );
      }
      return actions;
    },
  },
  methods: {
    queryModelSuggestions(query, callback) {
      const keyword = query.trim().toLowerCase();
      const suggestions = this.llm.models
        .filter((model) => !keyword || model.toLowerCase().includes(keyword))
        .map((model) => ({ value: model }));
      callback(suggestions);
    },
    traditionalJudgeProfile() {
      return {
        version: 1,
        preset: 'traditional',
        submit: { mode: 'code', files: [{ label: '你的代码', kind: 'source', maxKB: 100 }] },
        assets: [],
        compile: [{ id: 'main', command: 'auto', inputs: [] }],
        run: {
          perCase: [
            {
              id: 'run',
              kind: 'exec',
              exec: 'main',
              args: [],
              stdin: { from: 'case.input' },
              limits: { time: 'problem', mem: 'problem' },
              capture: ['stdout', 'stderr'],
            },
            {
              id: 'check',
              kind: 'check',
              checker: 'default',
              args: ['case.input', 'step:run.stdout', 'case.answer'],
            },
          ],
        },
      };
    },
    emptyDraft() {
      return {
        statement: {
          title: this.problemInfo.title || '',
          description: this.problemInfo.description || '',
          tags: [...(this.problemInfo.tags || [])],
          timeLimit: Number(this.problemInfo.timeLimit) || 1000,
          memoryLimit: Number(this.problemInfo.memoryLimit) || 256,
          level: Number(this.problemInfo.level) || 0,
          samples: (Array.isArray(this.problemInfo.samples) ? this.problemInfo.samples : []).map(sample => ({
            key: this.key(),
            inputData: String(sample && sample.inputData != null ? sample.inputData : ''),
            outputData: String(sample && sample.outputData != null ? sample.outputData : ''),
          })),
        },
        std: { language: 'cpp', fileName: 'std.cpp', source: '', explanation: '' },
        solution: { title: `${this.problemInfo.title || '题目'} 题解`.slice(0, 20), markdown: '' },
        data: {
          cases: [],
          subtasks: [{ index: 1, score: 100, option: 0, skip: false, dependencies: [] }],
          generator: { language: 'cpp', fileName: 'ai-generator.cpp', source: '' },
          generation: {
            mode: 'per-case-stdout',
            cases: [],
            compile: 'g++ -O2 -std=c++14 ai-generator.cpp -o ai-generator',
            run: './ai-generator <name> <index> <subtaskId> <args...>',
            output: 'generator stdout -> .in, STD stdout -> .out',
            notes: '',
          },
          notes: '',
        },
        judge: {
          preset: 'traditional',
          profile: this.traditionalJudgeProfile(),
          yaml: '',
          assets: [],
          notes: '',
        },
      };
    },
    key() {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    },
    resetStream(closeConnection = true) {
      if (closeConnection) this.closeGenerationStream();
      this.clearGenerationPoll();
      this.generationDoneAnnounced = false;
      this.lastAutoTab = '';
      this.stream = {
        jobId: '',
        reasoning: '',
        status: '',
        state: '',
        error: '',
        warning: '',
        done: false,
        plan: [],
        parsedSections: [],
        startedSections: [],
        summary: '',
        checks: [],
        repairRound: 0,
      };
    },
    // 生成完成度驱动的计划勾选：完成的 section 越多，计划里被勾掉的条目越多。
    planItemDone(index) {
      const plan = this.stream.plan || [];
      if (!plan.length) return false;
      if (this.stream.done && this.stream.state !== 'error') return true;
      const total = Math.max(this.sections.length, 1);
      const finished = (this.stream.parsedSections || []).length;
      const doneCount = Math.floor(plan.length * finished / total);
      return index < doneCount;
    },
    sectionSummary(key) {
      const d = this.draft;
      if (!d) return '';
      if (key === 'statement') {
        const s = d.statement || {};
        return [s.title ? `《${s.title}》` : '', (s.samples || []).length ? `${s.samples.length} 组样例` : '']
          .filter(Boolean).join(' · ');
      }
      if (key === 'std') {
        const src = (d.std && d.std.source) || '';
        return src ? `${d.std.fileName || 'std.cpp'} · ${src.split('\n').length} 行` : '';
      }
      if (key === 'solution') {
        const md = (d.solution && d.solution.markdown) || '';
        return md ? `${md.length} 字` : '';
      }
      if (key === 'data') {
        const gen = (d.data && d.data.generation && d.data.generation.cases) || [];
        const st = (d.data && d.data.cases) || [];
        const bits = [];
        if (gen.length) bits.push(`${gen.length} 个生成点`);
        if (st.length) bits.push(`${st.length} 个静态点`);
        if (d.data && d.data.generator && d.data.generator.source) bits.push('含生成器');
        return bits.join(' · ');
      }
      if (key === 'judge') {
        const j = d.judge || {};
        const presetLabel = (this.judgePresets.find((p) => p.value === j.preset) || {}).label || j.preset;
        const assets = (j.assets || []).filter((a) => a.content);
        return [presetLabel, assets.length ? `${assets.length} 个资产` : ''].filter(Boolean).join(' · ');
      }
      return '';
    },
    jumpToSection(key) {
      this.activeTab = key;
      this.lastAutoTab = key;
    },
    clearGenerationPoll() {
      if (this.generationPollTimer) {
        clearTimeout(this.generationPollTimer);
        this.generationPollTimer = null;
      }
    },
    closeGenerationStream() {
      if (this.generationSource) {
        this.generationSource.close();
        this.generationSource = null;
      }
    },
    draftSectionKeys(raw) {
      const allowed = ['statement', 'std', 'solution', 'data', 'judge'];
      if (!raw || typeof raw !== 'object') return [];
      return allowed.filter(key => Object.prototype.hasOwnProperty.call(raw, key));
    },
    mergeDraftSections(baseRaw, incomingRaw, sections) {
      const base = this.normalizeDraft(baseRaw || {});
      const incoming = this.normalizeDraft(incomingRaw || {});
      const keys = Array.isArray(sections) && sections.length ? sections : this.draftSectionKeys(incomingRaw);
      keys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(incoming, key)) base[key] = incoming[key];
      });
      return base;
    },
    applyGeneratedDraft(data, model, options = {}) {
      const previousTab = this.activeTab;
      const incomingKeys = Array.isArray(options.sections) && options.sections.length
        ? options.sections
        : this.draftSectionKeys(data);
      this.draft = this.draft && incomingKeys.length
        ? this.mergeDraftSections(this.draft, data, incomingKeys)
        : this.normalizeDraft(data);
      if (!incomingKeys.length || incomingKeys.includes('judge')) {
        this.ensureJudgeAssetsFromProfile();
        this.syncJudgeProfileText();
      }
      if (model) this.llm.model = model;
      if (!options.keepSolutionMark) this.solutionMark = '';
      this.dataPreview = { cases: [], totalBytes: 0, sandboxGenerated: false };
      this.activeTab = options.preserveTab ? (previousTab || this.sections[0] || 'statement') : (this.sections[0] || 'statement');
    },
    normalizeDraft(raw) {
      const base = this.emptyDraft();
      const draft = raw || {};
      const statement = draft.statement || {};
      base.statement = {
        ...base.statement,
        ...statement,
        tags: Array.isArray(statement.tags) ? statement.tags : [],
        samples: (Array.isArray(statement.samples) ? statement.samples : []).map(sample => ({
          key: this.key(),
          inputData: String(sample && sample.inputData != null ? sample.inputData : ''),
          outputData: String(sample && sample.outputData != null ? sample.outputData : ''),
        })),
      };
      base.std = { ...base.std, ...(draft.std || {}) };
      base.solution = { ...base.solution, ...(draft.solution || {}) };
      const data = draft.data || {};
      base.data = {
        ...base.data,
        ...data,
        cases: (Array.isArray(data.cases) ? data.cases : []).map((item, index) => ({
          key: this.key(),
          name: String(item && item.name || index + 1),
          input: String(item && item.input != null ? item.input : ''),
          output: String(item && item.output != null ? item.output : ''),
          subtaskId: Number(item && item.subtaskId) || 1,
        })),
        subtasks: Array.isArray(data.subtasks) && data.subtasks.length ? data.subtasks : base.data.subtasks,
        generator: { ...base.data.generator, ...(data.generator || {}) },
        generation: {
          ...base.data.generation,
          ...(data.generation || data.generationPlan || {}),
          cases: (Array.isArray((data.generation || data.generationPlan || {}).cases)
            ? (data.generation || data.generationPlan || {}).cases
            : []).map((item, index) => {
            const rawArgs = item && item.args != null ? item.args : item && item.command;
            const args = Array.isArray(rawArgs)
              ? rawArgs.map(arg => String(arg))
              : String(item && (item.argsText != null ? item.argsText : rawArgs) || '').split(/\s+/).filter(Boolean);
            return {
              key: this.key(),
              name: String(item && item.name || index + 1),
              subtaskId: Number(item && item.subtaskId) || 1,
              args,
              argsText: args.join(' '),
              stdin: String(item && item.stdin || ''),
              note: String(item && (item.note || item.description) || ''),
            };
          }),
        },
        notes: String(data.notes || ''),
      };
      const judge = draft.judge || {};
      const profile = judge.profile && typeof judge.profile === 'object'
        ? judge.profile
        : base.judge.profile;
      base.judge = {
        ...base.judge,
        preset: String(judge.preset || profile.preset || base.judge.preset),
        profile,
        yaml: String(judge.yaml || judge.profileYaml || judge.problemYaml || ''),
        assets: (Array.isArray(judge.assets) ? judge.assets : []).map((asset, index) => ({
          key: this.key(),
          name: String(asset && (asset.name || asset.fileName) || `asset-${index + 1}.cpp`),
          role: String(asset && asset.role || 'asset'),
          language: String(asset && (asset.language || asset.lang) || 'cpp'),
          content: String(asset && (asset.content != null ? asset.content : asset && asset.source) || ''),
        })),
        notes: String(judge.notes || ''),
      };
      return base;
    },
    syncJudgeProfileText() {
      if (!this.draft || !this.draft.judge) {
        this.judgeProfileText = '';
        this.judgeYamlText = '';
        this.judgeYamlError = '';
        this.lastSyncedJudgeProfileText = '';
        this.lastSyncedJudgeYamlText = '';
        return;
      }
      this.judgeProfileText = JSON.stringify(this.draft.judge.profile || {}, null, 2);
      this.judgeYamlText = this.draft.judge.yaml || this.dumpJudgeYaml(this.draft.judge.profile || {});
      this.judgeYamlError = '';
      this.lastSyncedJudgeProfileText = this.judgeProfileText;
      this.lastSyncedJudgeYamlText = this.judgeYamlText;
    },
    dumpJudgeYaml(profile) {
      try {
        return jsyaml.safeDump(profile || {}, { indent: 2, lineWidth: 100 });
      } catch (_) {
        return '';
      }
    },
    extractYamlProfile(payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
      if (payload.judgeProfile && typeof payload.judgeProfile === 'object' && !Array.isArray(payload.judgeProfile)) {
        return payload.judgeProfile;
      }
      if (payload.profile && typeof payload.profile === 'object' && !Array.isArray(payload.profile)) {
        return payload.profile;
      }
      return payload;
    },
    parseJudgeYamlText() {
      try {
        const payload = jsyaml.safeLoad(this.judgeYamlText || '');
        const profile = this.extractYamlProfile(payload);
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
          this.judgeYamlError = 'nywoj.yaml 必须是对象';
          return null;
        }
        this.judgeYamlError = '';
        return profile;
      } catch (err) {
        this.judgeYamlError = err.message;
        this.$message.error(`nywoj.yaml 格式错误：${err.message}`);
        return null;
      }
    },
    onJudgeYamlInput() {
      if (this.draft && this.draft.judge) this.draft.judge.yaml = this.judgeYamlText;
      if (!this.judgeYamlText.trim()) {
        this.judgeYamlError = '';
        return;
      }
      try {
        jsyaml.safeLoad(this.judgeYamlText);
        this.judgeYamlError = '';
      } catch (err) {
        this.judgeYamlError = err.message;
      }
    },
    parseJudgeProfileText() {
      try {
        const profile = JSON.parse(this.judgeProfileText || '{}');
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
          this.$message.error('judgeProfile 必须是 JSON 对象');
          return null;
        }
        return profile;
      } catch (err) {
        this.$message.error(`judgeProfile JSON 格式错误：${err.message}`);
        return null;
      }
    },
    parseJudgeForSave() {
      const jsonChanged = this.judgeProfileText !== this.lastSyncedJudgeProfileText;
      const yamlChanged = this.judgeYamlText !== this.lastSyncedJudgeYamlText;
      if (yamlChanged && !jsonChanged && this.judgeYamlText.trim()) {
        const profile = this.parseJudgeYamlText();
        if (profile) this.judgeProfileText = JSON.stringify(profile, null, 2);
        return profile;
      }
      const profile = this.parseJudgeProfileText();
      if (!profile) return null;
      this.judgeYamlText = this.dumpJudgeYaml(profile);
      this.judgeYamlError = '';
      if (this.draft && this.draft.judge) this.draft.judge.yaml = this.judgeYamlText;
      return profile;
    },
    ensureJudgeAssetsFromProfile() {
      if (!this.draft || !this.draft.judge || !this.draft.judge.profile) return;
      const declared = Array.isArray(this.draft.judge.profile.assets) ? this.draft.judge.profile.assets : [];
      const have = new Set(this.draft.judge.assets.map(asset => asset.name));
      for (const asset of declared) {
        const name = String(asset && asset.name || '');
        if (!name || have.has(name)) continue;
        this.draft.judge.assets.push({
          key: this.key(),
          name,
          role: String(asset.role || 'asset'),
          language: String(asset.lang || asset.language || 'cpp'),
          content: '',
        });
        have.add(name);
      }
    },
    editorLanguageOf(value) {
      const text = String(value || '').toLowerCase();
      if (text.includes('python') || text.endsWith('.py')) return 'python';
      if (text.includes('java') || text.endsWith('.java')) return 'java';
      if (text.includes('javascript') || text.endsWith('.js')) return 'javascript';
      if (text.includes('c') || text.endsWith('.cpp') || text.endsWith('.cc') || text.endsWith('.cxx')) return 'cpp';
      return 'cpp';
    },
    judgeAssetLanguage(asset) {
      return this.editorLanguageOf(`${asset.language || ''} ${asset.name || ''}`);
    },
    sectionLabel(key) {
      return ({ statement: '题面', std: 'STD', solution: '题解', data: '数据', judge: '评测' })[key] || key;
    },
    chatStorageKey() {
      return `nywoj-ai-chat-${this.pid}`;
    },
    loadChat() {
      try {
        const raw = localStorage.getItem(this.chatStorageKey());
        const list = raw ? JSON.parse(raw) : [];
        this.chat = Array.isArray(list) ? list.slice(-30) : [];
      } catch (_) {
        this.chat = [];
      }
    },
    saveChat() {
      try {
        localStorage.setItem(this.chatStorageKey(), JSON.stringify(this.chat.slice(-30)));
      } catch (_) {
        // localStorage 满/禁用不影响功能
      }
    },
    pushChatTurn(turn) {
      this.chat.push({ key: this.key(), time: Date.now(), ...turn });
      if (this.chat.length > 30) this.chat.splice(0, this.chat.length - 30);
      this.saveChat();
    },
    clearChat() {
      this.chat = [];
      this.saveChat();
    },
    applyQuickAction(action) {
      this.prompt = action.prompt;
      if (action.send) this.generateDraft();
    },
    applyConfig(data) {
      const cfg = data || {};
      this.llm.baseUrl = cfg.baseUrl || this.llm.baseUrl;
      this.llm.hasKey = !!cfg.hasKey;
      this.llm.keyPreview = cfg.keyPreview || '';
      this.llm.model = cfg.model || this.llm.model;
    },
    async loadAll() {
      const authRes = await axios.post('/api/problem/getProblemAuth', { pid: this.pid });
      this.auth = authRes.data.data || {};
      if (!this.auth.manage) {
        this.$message.warning('你没有该题目的管理权限');
        this.$router.push(`/problem/${this.pid}`);
        return;
      }
      const [problemRes, configRes] = await Promise.all([
        axios.post('/api/problem/getProblemInfo', { pid: this.pid }),
        axios.post('/api/problem/ai/config', { pid: this.pid }),
      ]);
      this.problemInfo = problemRes.data.data || {};
      this.problemInfo.isPublic = !!this.problemInfo.isPublic;
      this.applyConfig(configRes.data.data || {});
      this.draft = this.emptyDraft();
      this.syncJudgeProfileText();
      this.loadChat();
      await this.loadLatestGeneration();
    },
    async saveConfig() {
      this.llm.saving = true;
      try {
        const payload = {
          baseUrl: this.llm.baseUrl,
          model: this.llm.model,
        };
        if (this.llm.apiKeyInput.trim()) payload.apiKey = this.llm.apiKeyInput.trim();
        const res = await axios.post('/api/problem/ai/saveConfig', payload);
        if (res.status === 200 && res.data.data) {
          this.applyConfig(res.data.data);
          this.llm.apiKeyInput = '';
          this.$message.success('LLM 配置已保存');
        } else {
          this.$message.error(res.data.message || '保存配置失败');
        }
      } catch (err) {
        this.$message.error((err.response && err.response.data && err.response.data.message) || err.message || '保存配置失败');
      } finally {
        this.llm.saving = false;
      }
    },
    async loadModels() {
      this.llm.modelsLoading = true;
      try {
        const payload = {
          baseUrl: this.llm.baseUrl,
          model: this.llm.model,
        };
        if (this.llm.apiKeyInput.trim()) payload.apiKey = this.llm.apiKeyInput.trim();
        const res = await axios.post('/api/problem/ai/models', payload);
        if (res.status === 200 && res.data.data) {
          this.llm.models = res.data.data.models || [];
          if (res.data.data.model) this.llm.model = res.data.data.model;
          this.$message.success(this.llm.models.length ? '模型列表已更新' : '模型接口未返回模型列表');
        } else {
          this.$message.error(res.data.message || '读取模型失败');
        }
      } catch (err) {
        this.$message.error((err.response && err.response.data && err.response.data.message) || err.message || '读取模型失败');
      } finally {
        this.llm.modelsLoading = false;
      }
    },
    async ensureConfigSaved() {
      if (!this.llm.hasKey && !this.llm.apiKeyInput.trim()) {
        this.$message.error('请先填写并保存自己的 LLM Key');
        return false;
      }
      if (this.llm.apiKeyInput.trim()) {
        await this.saveConfig();
      }
      return this.llm.hasKey;
    },
    rememberPrompt(prompt) {
      const text = String(prompt || '').trim();
      if (!text) return;
      const last = this.promptHistory[this.promptHistory.length - 1];
      if (last !== text) this.promptHistory.push(text);
      if (this.promptHistory.length > 8) this.promptHistory.splice(0, this.promptHistory.length - 8);
    },
    currentJudgeProfileForContext() {
      if (!this.draft || !this.draft.judge) return {};
      const jsonChanged = this.judgeProfileText !== this.lastSyncedJudgeProfileText;
      const yamlChanged = this.judgeYamlText !== this.lastSyncedJudgeYamlText;
      if (yamlChanged && this.judgeYamlText.trim()) {
        try {
          const payload = jsyaml.safeLoad(this.judgeYamlText || '');
          const profile = this.extractYamlProfile(payload);
          if (profile && typeof profile === 'object' && !Array.isArray(profile)) return profile;
        } catch (_) {
          // Keep the last valid profile as context while the user is editing YAML.
        }
      }
      if (jsonChanged && this.judgeProfileText.trim()) {
        try {
          const profile = JSON.parse(this.judgeProfileText);
          if (profile && typeof profile === 'object' && !Array.isArray(profile)) return profile;
        } catch (_) {
          // Keep the last valid profile as context while the user is editing JSON.
        }
      }
      return this.draft.judge.profile || {};
    },
    currentDraftPayload() {
      const draft = this.draft || this.emptyDraft();
      const data = this.dataPayload({ compactStaticCases: true });
      return {
        statement: {
          title: draft.statement.title,
          description: draft.statement.description,
          tags: Array.isArray(draft.statement.tags) ? draft.statement.tags : [],
          timeLimit: draft.statement.timeLimit,
          memoryLimit: draft.statement.memoryLimit,
          level: draft.statement.level,
          samples: (draft.statement.samples || []).map(sample => ({
            inputData: sample.inputData || '',
            outputData: sample.outputData || '',
          })),
        },
        std: {
          language: draft.std.language,
          fileName: draft.std.fileName,
          source: draft.std.source,
          explanation: draft.std.explanation || '',
        },
        solution: {
          title: draft.solution.title,
          markdown: draft.solution.markdown,
        },
        data,
        judge: {
          preset: draft.judge.preset,
          profile: this.currentJudgeProfileForContext(),
          yaml: this.judgeYamlText || draft.judge.yaml || '',
          assets: (draft.judge.assets || []).map(asset => ({
            name: asset.name,
            role: asset.role,
            language: asset.language,
            content: asset.content,
          })),
          notes: draft.judge.notes || '',
        },
      };
    },
    async generateDraft() {
      if (!this.prompt.trim()) {
        this.$message.error('请输入提示词');
        return;
      }
      if (!this.sections.length) {
        this.$message.error('请选择生成内容');
        return;
      }
      if (!(await this.ensureConfigSaved())) return;
      this.resetStream();
      this.loading = true;
      try {
        const payload = {
          pid: this.pid,
          prompt: this.prompt,
          sections: this.sections,
          model: this.llm.model,
          currentDraft: this.currentDraftPayload(),
          promptHistory: this.promptHistory,
        };
        const res = await axios.post('/api/problem/ai/startGenerate', payload);
        if (res.status !== 200) {
          throw new Error((res.data && res.data.message) || '后台任务创建失败');
        }
        const job = res.data && res.data.data;
        if (!job || !job.jobId) throw new Error('后台任务创建失败');
        this.rememberPrompt(this.prompt);
        this.pushChatTurn({ role: 'user', text: this.prompt });
        this.prompt = '';
        this.handleGenerationSnapshot(job);
        this.connectGenerationStream(job.jobId);
      } catch (err) {
        const message = this.apiError(err, '生成失败');
        this.stream.error = message;
        this.$message.error(message);
        this.loading = false;
      }
    },
    async loadLatestGeneration() {
      try {
        const res = await axios.post('/api/problem/ai/generation', { pid: this.pid });
        const job = res.data && res.data.data;
        if (!job) return;
        this.handleGenerationSnapshot(job, { quiet: true });
        if (job.jobId && (job.status === 'queued' || job.status === 'running')) this.connectGenerationStream(job.jobId);
      } catch (_) {
        // Loading a saved AI preview is best-effort and should not block editing.
      }
    },
    statusLabel(status) {
      const labels = {
        queued: '任务已进入后台队列。',
        running: '后台任务正在生成。',
        done: '草稿已生成，可继续预览和修改。',
        done_with_warning: '已恢复出可用预览，请检查后再保存。',
        cancelled: '已停止本次生成。',
        error: '生成失败',
      };
      return labels[status] || '';
    },
    isGenerationActive(status) {
      return status === 'queued' || status === 'running';
    },
    isGenerationTerminal(status) {
      return status === 'done' || status === 'done_with_warning' || status === 'error' || status === 'cancelled';
    },
    handleGenerationSnapshot(job, options = {}) {
      if (!job) return;
      const state = job.status || this.stream.state;
      const wasDone = this.stream.done;
      this.stream.jobId = job.jobId || this.stream.jobId;
      this.stream.state = state || '';
      this.stream.status = job.statusText || this.statusLabel(state) || this.stream.status;
      this.stream.reasoning = job.reasoning || '';
      this.stream.error = job.error || '';
      this.stream.warning = job.warning || '';
      this.stream.done = this.isGenerationTerminal(state);
      if (Array.isArray(job.plan) && job.plan.length) this.stream.plan = job.plan;
      if (Array.isArray(job.parsedSections)) this.stream.parsedSections = job.parsedSections;
      if (Array.isArray(job.startedSections)) this.stream.startedSections = job.startedSections;
      if (job.summary) this.stream.summary = job.summary;
      if (Array.isArray(job.checks) && job.checks.length) this.stream.checks = job.checks;
      if (job.repairRound) this.stream.repairRound = job.repairRound;
      if (job.model) this.llm.model = job.model;
      if (job.draft) this.applyGeneratedDraft(job.draft, job.model, { preserveTab: true, sections: job.parsedSections });

      this.loading = this.isGenerationActive(state);
      // 像真人切页配置一样：正在撰写哪个部分，就把预览切到对应 Tab。
      // 用户手动点过的 Tab（jumpToSection 会同步 lastAutoTab）不再被抢走。
      if (this.loading && !options.quiet) {
        const started = this.stream.startedSections || [];
        const current = started.length ? started[started.length - 1] : '';
        if (current && current !== this.lastAutoTab && this.sections.includes(current)) {
          this.activeTab = current;
          this.lastAutoTab = current;
        }
      }
      if (!this.stream.done) return;

      this.loading = false;
      this.closeGenerationStream();
      this.clearGenerationPoll();
      if (job.prompt) this.rememberPrompt(job.prompt);
      if (options.quiet) {
        // 页面刷新后载入历史预览：本地对话记录为空时补一轮，让上下文可见。
        if (!this.chat.length && job.prompt && (state === 'done' || state === 'done_with_warning')) {
          this.pushChatTurn({ role: 'user', text: job.prompt });
          this.pushChatTurn(this.assistantTurnFromStream(state, job));
        }
        return;
      }
      if (wasDone || this.generationDoneAnnounced) return;
      this.generationDoneAnnounced = true;
      if (state !== 'cancelled') this.pushChatTurn(this.assistantTurnFromStream(state, job));
      if (state === 'error') this.$message.error(this.stream.error || '生成失败');
      else if (state === 'done_with_warning') this.$message.warning(this.stream.warning || '已恢复出可用预览，请检查后再保存');
      else if (state === 'cancelled') this.$message.info('已停止生成');
      else this.$message.success('草稿已生成');
    },
    assistantTurnFromStream(state, job) {
      const fallback = {
        done: '草稿已更新，去下面的预览里看看吧。',
        done_with_warning: this.stream.warning || '草稿已生成，但自检有遗留问题，请查看自检报告。',
        error: this.stream.error || '生成失败了，请调整要求后重试。',
      };
      return {
        role: 'assistant',
        status: state,
        text: this.stream.summary || fallback[state] || '本轮已结束。',
        sections: [...(job && job.parsedSections || [])],
        checkFails: (this.stream.checks || []).filter(c => c.status === 'fail').length,
      };
    },
    async cancelGeneration() {
      const jobId = this.stream.jobId;
      if (!jobId || !this.generationActive) return;
      this.generationStopping = true;
      try {
        const res = await axios.post('/api/problem/ai/cancelGeneration', { pid: this.pid, jobId });
        this.handleGenerationSnapshot(res.data && res.data.data);
      } catch (err) {
        const message = (err.response && err.response.data && err.response.data.message) || err.message || '停止生成失败';
        this.$message.error(message);
      } finally {
        this.generationStopping = false;
        this.loading = false;
        this.closeGenerationStream();
        this.clearGenerationPoll();
      }
    },
    connectGenerationStream(jobId) {
      this.closeGenerationStream();
      if (!jobId || !window.EventSource) {
        this.scheduleGenerationPoll(jobId);
        return;
      }
      const source = new EventSource(`/api/problem/ai/generationStream?jobId=${encodeURIComponent(jobId)}`);
      this.generationSource = source;
      const onSnapshot = (event) => {
        try {
          this.handleGenerationSnapshot(JSON.parse(event.data || '{}'));
        } catch (_) {
          this.stream.warning = '收到一条无法解析的后台状态，正在继续等待。';
        }
      };
      source.addEventListener('snapshot', onSnapshot);
      source.addEventListener('update', onSnapshot);
      source.addEventListener('done', onSnapshot);
      source.addEventListener('error', (event) => {
        if (event && event.data) {
          onSnapshot(event);
          return;
        }
        if (this.stream.done) return;
        this.closeGenerationStream();
        this.stream.status = '订阅连接断开，后台任务仍在运行，正在轮询状态。';
        this.scheduleGenerationPoll(jobId);
      });
    },
    scheduleGenerationPoll(jobId) {
      this.clearGenerationPoll();
      if (!jobId || this.stream.done) return;
      this.generationPollTimer = setTimeout(async () => {
        this.generationPollTimer = null;
        try {
          const res = await axios.post('/api/problem/ai/generation', { pid: this.pid, jobId });
          this.handleGenerationSnapshot(res.data && res.data.data);
        } catch (err) {
          const message = (err.response && err.response.data && err.response.data.message) || err.message || '读取后台生成状态失败';
          this.stream.status = message;
        }
        if (!this.stream.done && this.stream.jobId === jobId) this.scheduleGenerationPoll(jobId);
      }, 1200);
    },
    resetDraft() {
      this.draft = this.emptyDraft();
      this.syncJudgeProfileText();
      this.solutionMark = '';
      this.dataPreview = { cases: [], totalBytes: 0, sandboxGenerated: false };
    },
    addSample() {
      this.draft.statement.samples.push({ key: this.key(), inputData: '', outputData: '' });
    },
    removeSample(index) {
      this.draft.statement.samples.splice(index, 1);
    },
    addCase() {
      const index = this.draft.data.cases.length + 1;
      this.draft.data.cases.push({ key: this.key(), name: String(index), input: '', output: '', subtaskId: 1 });
    },
    removeCase(index) {
      this.draft.data.cases.splice(index, 1);
    },
    addGenerationCase() {
      const index = this.draft.data.generation.cases.length + 1;
      this.draft.data.generation.cases.push({
        key: this.key(),
        name: String(index),
        subtaskId: 1,
        args: [],
        argsText: `seed=${index}`,
        stdin: '',
        note: '',
      });
    },
    removeGenerationCase(index) {
      this.draft.data.generation.cases.splice(index, 1);
    },
    addJudgeAsset() {
      const index = this.draft.judge.assets.length + 1;
      this.draft.judge.assets.push({
        key: this.key(),
        name: `asset-${index}.cpp`,
        role: 'asset',
        language: 'cpp',
        content: '',
      });
    },
    removeJudgeAsset(index) {
      this.draft.judge.assets.splice(index, 1);
    },
    async loadJudgePreset() {
      if (!this.draft || !this.draft.judge) return;
      this.loadingJudgePreset = true;
      try {
        const res = await axios.post('/api/problem/getJudgePreset', { pid: this.pid, preset: this.draft.judge.preset });
        if (res.status === 200 && res.data.data) {
          this.draft.judge.profile = res.data.data;
          this.draft.judge.preset = res.data.data.preset || this.draft.judge.preset;
          this.draft.judge.yaml = this.dumpJudgeYaml(this.draft.judge.profile);
          this.ensureJudgeAssetsFromProfile();
          this.syncJudgeProfileText();
          this.$message.success('评测预设已套用');
        } else {
          this.$message.error((res.data && res.data.message) || '读取评测预设失败');
        }
      } catch (err) {
        this.$message.error((err.response && err.response.data && err.response.data.message) || err.message || '读取评测预设失败');
      } finally {
        this.loadingJudgePreset = false;
      }
    },
    async saveStatement() {
      this.savingStatement = true;
      try {
        const info = {
          ...this.problemInfo,
          title: this.draft.statement.title,
          description: this.draft.statement.description,
          tags: this.draft.statement.tags,
          timeLimit: this.draft.statement.timeLimit,
          memoryLimit: this.draft.statement.memoryLimit,
          level: this.draft.statement.level,
          samples: this.draft.statement.samples.map(sample => ({
            inputData: sample.inputData || '',
            outputData: sample.outputData || '',
          })),
        };
        const res = await axios.post('/api/problem/updateProblem', { pid: this.pid, info });
        if (res.status === 200) {
          this.$message.success('题面已保存');
          this.problemInfo = { ...this.problemInfo, ...info };
        } else {
          this.$message.error(res.data.message || '保存题面失败');
        }
      } catch (err) {
        this.$message.error((err.response && err.response.data && err.response.data.message) || err.message || '保存题面失败');
      } finally {
        this.savingStatement = false;
      }
    },
    async saveStd() {
      this.savingStd = true;
      try {
        const res = await axios.post('/api/problem/ai/saveStd', { pid: this.pid, std: this.draft.std });
        if (res.status === 200) this.$message.success(`已保存为 ${res.data.name}`);
        else this.$message.error(res.data.message || '保存 STD 失败');
      } catch (err) {
        this.$message.error((err.response && err.response.data && err.response.data.message) || err.message || '保存 STD 失败');
      } finally {
        this.savingStd = false;
      }
    },
    async saveSolution() {
      this.savingSolution = true;
      try {
        const res = await axios.post('/api/problem/ai/saveSolution', { pid: this.pid, solution: this.draft.solution });
        if (res.status === 200 && res.data.mark) {
          this.solutionMark = res.data.mark;
          this.$message.success('题解草稿已创建');
        } else {
          this.$message.error((res.data && res.data.message) || '创建题解草稿失败');
        }
      } catch (err) {
        this.$message.error((err.response && err.response.data && err.response.data.message) || err.message || '创建题解草稿失败');
      } finally {
        this.savingSolution = false;
      }
    },
    dataPayload(options = {}) {
      const generationCases = (this.draft.data.generation && this.draft.data.generation.cases) || [];
      const compactStaticCases = !!options.compactStaticCases;
      return {
        ...this.draft.data,
        cases: this.draft.data.cases.map(item => ({
          name: item.name,
          input: compactStaticCases ? this.contextCasePreview(item.input) : item.input,
          output: compactStaticCases ? this.contextCasePreview(item.output) : item.output,
          inputBytes: compactStaticCases ? this.textBytes(item.input) : undefined,
          outputBytes: compactStaticCases ? this.textBytes(item.output) : undefined,
          subtaskId: item.subtaskId,
        })),
        generation: {
          ...this.draft.data.generation,
          cases: generationCases.map(item => ({
            name: item.name,
            subtaskId: item.subtaskId,
            args: String(item.argsText || '').split(/\s+/).filter(Boolean),
            stdin: item.stdin || '',
            note: item.note || '',
          })),
        },
      };
    },
    textBytes(value) {
      const text = String(value == null ? '' : value);
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
      try {
        return unescape(encodeURIComponent(text)).length;
      } catch (_) {
        return text.length;
      }
    },
    contextCasePreview(value) {
      const text = String(value == null ? '' : value);
      return text.length > CONTEXT_CASE_PREVIEW_CHARS
        ? `${text.slice(0, CONTEXT_CASE_PREVIEW_CHARS)}\n...(truncated)`
        : text;
    },
    dataWithoutStaticCases(data) {
      return { ...data, cases: [] };
    },
    dataMetaPayload(data) {
      return {
        ...data,
        cases: (data.cases || []).map(item => ({
          name: item.name,
          subtaskId: item.subtaskId,
        })),
        generation: { ...data.generation, cases: [] },
      };
    },
    previewCaseText(value, maxChars = 4096) {
      const text = String(value == null ? '' : value);
      const bytes = this.textBytes(text);
      if (text.length <= maxChars) return { content: text, bytes, truncated: false };
      return { content: `${text.slice(0, maxChars)}\n...(truncated)`, bytes, truncated: true };
    },
    previewStaticData(data) {
      let totalBytes = 0;
      const cases = (data.cases || []).map((item, index) => {
        const input = this.previewCaseText(item.input);
        const output = this.previewCaseText(item.output);
        totalBytes += input.bytes + output.bytes;
        return {
          index: index + 1,
          name: item.name || String(index + 1),
          subtaskId: item.subtaskId || 1,
          input,
          output,
        };
      });
      return { cases, totalBytes, sandboxGenerated: false, generatorSaved: false };
    },
    caseSaveFormData(sessionId, index, item) {
      const form = new FormData();
      form.append('pid', String(this.pid));
      form.append('sessionId', sessionId);
      form.append('index', String(index));
      form.append('input', new Blob([String(item.input == null ? '' : item.input)], { type: 'text/plain;charset=utf-8' }), `${index}.in`);
      form.append('output', new Blob([String(item.output == null ? '' : item.output)], { type: 'text/plain;charset=utf-8' }), `${index}.out`);
      return form;
    },
    async saveStaticDataInChunks(data) {
      const startRes = await axios.post('/api/problem/ai/startDataSave', {
        pid: this.pid,
        data: this.dataMetaPayload(data),
        confirmReplace: true,
      });
      if (startRes.status !== 200 || !startRes.data || !startRes.data.sessionId) {
        throw new Error((startRes.data && startRes.data.message) || '创建保存会话失败');
      }
      const sessionId = startRes.data.sessionId;
      const cases = data.cases || [];
      for (let i = 0; i < cases.length; i++) {
        try {
          const caseRes = await axios.post('/api/problem/ai/saveDataCase', this.caseSaveFormData(sessionId, i + 1, cases[i]));
          if (caseRes.status !== 200) {
            throw new Error((caseRes.data && caseRes.data.message) || '写入失败');
          }
        } catch (err) {
          throw new Error(`写入第 ${i + 1}/${cases.length} 个测试点失败：${this.apiError(err, '写入失败')}`);
        }
      }
      return axios.post('/api/problem/ai/finishDataSave', { pid: this.pid, sessionId });
    },
    validateDataDraft() {
      const data = this.dataPayload();
      const generationCases = (this.draft.data.generation && this.draft.data.generation.cases) || [];
      if (!generationCases.length) {
        for (const item of data.cases || []) {
          const inputBytes = this.textBytes(item.input);
          const outputBytes = this.textBytes(item.output);
          if (inputBytes > MAX_STATIC_CASE_FILE_BYTES || outputBytes > MAX_STATIC_CASE_FILE_BYTES) {
            this.$message.error(
              `测试点 ${item.name || ''} 的单个输入或输出超过 ${this.formatBytes(MAX_STATIC_CASE_FILE_BYTES)}，请拆分数据或改用 Generator 在线生成`
            );
            return null;
          }
        }
      }
      if (!this.draft.data.cases.length && !generationCases.length) {
        this.$message.error('请至少保留一个生成点或静态 Case');
        return null;
      }
      if (generationCases.length && !String(this.draft.std.source || '').trim()) {
        this.$message.error('在线生成需要 STD');
        return null;
      }
      return data;
    },
    async previewData() {
      const data = this.validateDataDraft();
      if (!data) return;
      const generationCases = data.generation.cases || [];
      if (!generationCases.length) {
        this.dataPreview = this.previewStaticData(data);
        this.$message.success('预览已生成');
        return;
      }
      this.previewingData = true;
      try {
        const res = await axios.post('/api/problem/ai/previewData', {
          pid: this.pid,
          data: this.dataWithoutStaticCases(data),
          std: this.draft.std,
        });
        if (res.status === 200 && res.data.data) {
          this.dataPreview = res.data.data;
          this.$message.success('预览运行完成');
        } else {
          this.$message.error((res.data && res.data.message) || '预览失败');
        }
      } catch (err) {
        this.$message.error(this.apiError(err, '预览失败'));
      } finally {
        this.previewingData = false;
      }
    },
    async saveData() {
      const data = this.validateDataDraft();
      if (!data) return;
      const generationCases = (this.draft.data.generation && this.draft.data.generation.cases) || [];
      try {
        await ElMessageBox.confirm(
          generationCases.length
            ? '确认在 Rust sandbox 中运行生成器并写入测试数据？现有 config.json 会被替换。'
            : '确认用当前草稿写入测试数据？现有 config.json 会被替换。',
          '保存测试数据',
          { confirmButtonText: '保存', cancelButtonText: '取消', type: 'warning' }
        );
      } catch (_) {
        return;
      }
      this.savingData = true;
      try {
        const res = generationCases.length
          ? await axios.post('/api/problem/ai/saveData', {
            pid: this.pid,
            data: this.dataWithoutStaticCases(data),
            std: this.draft.std,
            confirmReplace: true,
          })
          : await this.saveStaticDataInChunks(data);
        if (res.status === 200) {
          const count = res.data && res.data.cases ? res.data.cases.length : 0;
          this.$message.success(res.data && res.data.sandboxGenerated ? `已在线生成并保存 ${count} 个测试点` : '测试数据已保存');
        }
        else this.$message.error((res.data && res.data.message) || '保存测试数据失败');
      } catch (err) {
        this.$message.error(this.apiError(err, '保存测试数据失败'));
      } finally {
        this.savingData = false;
      }
    },
    formatBytes(bytes) {
      const value = Number(bytes || 0);
      if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
      if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
      return `${value} B`;
    },
    apiError(err, fallback) {
      const status = err.response && err.response.status;
      const data = err.response && err.response.data;
      if (status === 413) return '请求内容过大，请减少静态数据或调大 HTTP.bodyLimit 后重试';
      if (data && typeof data === 'object' && data.message) return data.message;
      if (typeof data === 'string' && data.trim()) return data.slice(0, 200);
      return err.message || fallback;
    },
    async saveJudge() {
      const profile = this.parseJudgeForSave();
      if (!profile) return;
      this.savingJudge = true;
      try {
        const judge = {
          preset: profile.preset || this.draft.judge.preset,
          profile,
          yaml: this.judgeYamlText,
          assets: this.draft.judge.assets.map(asset => ({
            name: asset.name,
            role: asset.role,
            language: asset.language,
            content: asset.content,
          })),
          notes: this.draft.judge.notes,
        };
        const res = await axios.post('/api/problem/ai/saveJudge', { pid: this.pid, judge });
        if (res.status === 200 && res.data.data) {
          this.draft.judge.profile = profile;
          this.draft.judge.preset = profile.preset || this.draft.judge.preset;
          this.draft.judge.yaml = res.data.data.yaml || this.judgeYamlText || this.dumpJudgeYaml(profile);
          this.syncJudgeProfileText();
          const count = (res.data.data.savedAssets || []).length;
          const yamlName = res.data.data.savedYaml ? `，${res.data.data.savedYaml}` : '';
          this.$message.success(count ? `评测配置已保存，资产 ${count} 个${yamlName}` : `评测配置已保存${yamlName}`);
        } else {
          this.$message.error((res.data && res.data.message) || '保存评测配置失败');
        }
      } catch (err) {
        this.$message.error((err.response && err.response.data && err.response.data.message) || err.message || '保存评测配置失败');
      } finally {
        this.savingJudge = false;
      }
    },
  },
  mounted() {
    this.pid = this.$route.params.pid;
    this.loadAll();
  },
  beforeUnmount() {
    this.closeGenerationStream();
    this.clearGenerationPoll();
  },
};
</script>

<style scoped>
.ai-page {
  width: 100%;
  max-width: 1480px;
  min-width: 0;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 12px 0 24px;
  text-align: left;
}

.ai-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 0 16px;
  border-bottom: 1px solid #dcdfe6;
}

.eyebrow {
  color: #409eff;
  font-size: 13px;
  font-weight: 700;
}

h1,
h2 {
  margin: 0;
  color: #303133;
}

h1 {
  font-size: 28px;
  line-height: 1.25;
}

h2 {
  font-size: 17px;
}

.subline {
  margin-top: 4px;
  color: #606266;
}

.header-actions,
.generate-row,
.tab-actions,
.model-row,
.block-head,
.section-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.header-actions {
  justify-content: flex-end;
}

.config-band,
.guide-band,
.prompt-band,
.stream-band,
.draft-band {
  padding: 16px 0;
  border-bottom: 1px solid #ebeef5;
}

.config-form {
  display: grid;
  grid-template-columns: minmax(220px, 1.1fr) minmax(220px, 1.1fr) minmax(260px, 1.4fr) auto;
  gap: 12px;
  align-items: end;
}

.model-row {
  flex-wrap: nowrap;
}

.model-row .el-autocomplete {
  flex: 1;
  min-width: 180px;
}

.guide-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.guide-head p {
  margin: 4px 0 0;
  color: #606266;
  font-size: 13px;
}

.guide-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.guide-item {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
}

.guide-item span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  border-radius: 50%;
  color: #fff;
  background: #409eff;
  font-size: 12px;
  font-weight: 700;
}

.guide-item strong {
  color: #303133;
  font-size: 13px;
}

.guide-item p {
  margin: 2px 0 0;
  color: #606266;
  font-size: 12px;
  line-height: 1.45;
}

.section-line {
  justify-content: space-between;
  margin-bottom: 10px;
}

.section-line p {
  margin: 4px 0 0;
  color: #606266;
  font-size: 13px;
}

.section-picker {
  white-space: nowrap;
}

.generate-row {
  justify-content: flex-end;
  align-items: center;
  margin-top: 10px;
}

.send-hint {
  margin-right: auto;
  color: #c0c4cc;
  font-size: 12px;
}

.chat-list {
  display: grid;
  gap: 8px;
  max-height: 320px;
  margin-bottom: 12px;
  padding: 12px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fbfdff;
}

.chat-turn {
  display: flex;
}

.chat-turn.chat-user {
  justify-content: flex-end;
}

.chat-turn.chat-assistant {
  justify-content: flex-start;
}

.chat-bubble {
  max-width: 78%;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.6;
}

.chat-user .chat-bubble {
  background: #409eff;
  color: #fff;
  border-bottom-right-radius: 3px;
}

.chat-assistant .chat-bubble {
  background: #fff;
  border: 1px solid #e4e7ed;
  color: #303133;
  border-bottom-left-radius: 3px;
}

.chat-assistant .chat-bubble.chat-warn {
  border-color: #f3d19e;
  background: #fdf6ec;
}

.chat-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.chat-tools {
  display: flex;
  justify-content: center;
}

.quick-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.quick-hint {
  color: #909399;
  font-size: 12px;
}

.quick-chip {
  cursor: pointer;
  user-select: none;
}

.quick-chip:hover {
  border-color: #409eff;
  color: #409eff;
}

.checks-box {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fbfdff;
}

.checks-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.checks-head .editor-label {
  margin: 0 0 6px;
}

.check-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
  font-size: 13px;
}

.check-icon {
  flex: 0 0 16px;
  color: #909399;
}

.check-pass .check-icon {
  color: #67c23a;
}

.check-fail .check-icon {
  color: #f56c6c;
}

.check-label {
  font-weight: 600;
  color: #303133;
  white-space: nowrap;
}

.check-fail .check-label {
  color: #f56c6c;
}

.check-detail {
  color: #64748b;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.check-fail .check-detail {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
}

.draft-band {
  min-height: 280px;
}

.stream-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.stream-head p {
  margin: 4px 0 0;
  color: #606266;
  font-size: 13px;
}

.progress-grid {
  display: grid;
  grid-template-columns: minmax(280px, .9fr) minmax(320px, 1.1fr);
  gap: 12px;
  margin-top: 10px;
}

.plan-box,
.section-progress {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fbfdff;
}

.plan-box .editor-label,
.section-progress .editor-label {
  margin-top: 0;
}

.plan-waiting {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #909399;
  font-size: 13px;
  padding: 6px 0;
}

.plan-list {
  display: grid;
  gap: 6px;
}

.plan-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: #303133;
  line-height: 1.5;
}

.plan-item.is-done .plan-text {
  color: #94a3b8;
  text-decoration: line-through;
}

.plan-icon {
  flex: 0 0 16px;
  margin-top: 2px;
  color: #c0c4cc;
  font-size: 14px;
}

.plan-icon.ok {
  color: #67c23a;
}

.plan-pop-enter-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.plan-pop-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.section-progress {
  display: block;
}

.sp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  margin-bottom: 6px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.sp-item.sp-done,
.sp-item.sp-writing {
  cursor: pointer;
}

.sp-item.sp-done:hover {
  border-color: #b3e19d;
}

.sp-item.sp-done {
  background: #f0f9eb;
  border-color: #e1f3d8;
}

.sp-item.sp-writing {
  background: #ecf5ff;
  border-color: #d9ecff;
}

.sp-item.sp-kept {
  cursor: pointer;
  opacity: 0.75;
}

.sp-icon {
  display: inline-flex;
  width: 16px;
  color: #909399;
}

.sp-done .sp-icon {
  color: #67c23a;
}

.sp-writing .sp-icon {
  color: #409eff;
}

.sp-dot {
  color: #c0c4cc;
}

.sp-label {
  font-weight: 700;
  color: #303133;
}

.sp-summary {
  margin-left: auto;
  color: #64748b;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}

.reasoning-collapse {
  margin-top: 10px;
}

.reasoning-pre {
  box-sizing: border-box;
  width: 100%;
  max-height: 280px;
  margin: 0;
  padding: 10px;
  overflow: auto;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #f8fafc;
  color: #303133;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.tab-actions {
  margin-bottom: 12px;
}

.statement-grid {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(220px, 1.2fr) repeat(3, minmax(130px, .65fr));
  gap: 10px;
  margin-bottom: 8px;
}

.editor-label {
  margin: 14px 0 8px;
  color: #606266;
  font-size: 13px;
  font-weight: 700;
}

.sample-list,
.case-list {
  display: grid;
  gap: 10px;
}

.sample-block,
.case-block {
  padding: 10px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
}

.two-cols {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.file-input {
  width: min(100%, 280px);
}

.case-name {
  width: min(100%, 220px);
}

.case-args {
  flex: 1 1 320px;
  min-width: 220px;
}

.data-preview-panel {
  margin-top: 14px;
  padding: 10px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
}

.preview-head,
.preview-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.preview-head {
  justify-content: space-between;
  margin-bottom: 8px;
}

.preview-meta {
  margin-bottom: 4px;
  color: #909399;
  font-size: 12px;
}

.data-preview-panel pre {
  box-sizing: border-box;
  max-height: 160px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #f8fafc;
  color: #303133;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.preset-select {
  width: min(100%, 220px);
}

.judge-grid {
  display: grid;
  grid-template-columns: minmax(360px, .9fr) minmax(420px, 1.1fr);
  gap: 14px;
  align-items: start;
}

.asset-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.asset-list {
  display: grid;
  gap: 10px;
}

.asset-block {
  padding: 10px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
}

.asset-name {
  width: min(100%, 180px);
}

.asset-role {
  width: min(100%, 150px);
}

.asset-lang {
  width: min(100%, 110px);
}

.profile-json :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 13px;
  line-height: 1.5;
}

.yaml-alert {
  margin-bottom: 8px;
}

.el-button {
  margin-left: 0;
}

@media (max-width: 980px) {
  .ai-header,
  .section-line {
    align-items: flex-start;
    flex-direction: column;
  }

  .config-form,
  .guide-grid,
  .statement-grid,
  .judge-grid,
  .progress-grid,
  .two-cols {
    grid-template-columns: 1fr;
  }

  .model-row {
    flex-wrap: wrap;
  }

  .generate-row,
  .header-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 600px) {
  .ai-page {
    padding-top: 0;
  }

  h1 {
    font-size: 22px;
  }

  .config-band,
  .guide-band,
  .prompt-band,
  .stream-band,
  .draft-band {
    padding-block: 12px;
  }

  .model-row,
  .guide-head,
  .tab-actions,
  .block-head {
    align-items: stretch;
    flex-direction: column;
  }

  .model-row .el-autocomplete,
  .model-row :deep(.el-select),
  .model-row :deep(.el-input),
  .header-actions,
  .header-actions :deep(.el-button) {
    width: 100%;
    min-width: 0;
  }

  .preview-panel,
  .draft-card,
  .block {
    padding-inline: 10px;
  }
}
</style>
