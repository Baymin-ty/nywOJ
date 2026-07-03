<template>
  <el-row class="problem-view-page">
    <el-col :xs="24" :sm="24" :md="17">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header" style="height: 35px;">
            <p class="title">
              #{{ problemNumber }}、{{ problemInfo.title }}
              <el-icon id="hidden" v-if="!problemInfo.isPublic">
                <Hide />
              </el-icon>
            </p>
          </div>
        </template>
        <div v-if="isSubmit && isMultiSubmit" class="multi-submit">
          <div style="margin: 10px;">
            选择语言：
            <el-select v-model="submitLang" placeholder="选择语言" style="width: 160px;">
              <el-option v-for="l in this.langList" :key="l.id" :label="l.des" :value="l.id" />
            </el-select>
          </div>
          <div v-for="(slot, i) in submitSlots" :key="i" class="multi-slot">
            <div class="multi-slot-label">{{ slot.label || ('文件 ' + (i + 1)) }}<code v-if="slot.name"
                class="multi-slot-name">{{ slot.name }}</code></div>
            <monacoEditor v-if="slot.kind === 'source'" :value="multiCode[i] || ''" :language="submitEditorLang"
              :height="280" @update:value="setMultiContent(i, $event)" />
            <el-upload v-else drag :auto-upload="false" :limit="1" :on-change="(file) => onMultiFilePicked(file, i)"
              :on-remove="() => onMultiFileRemoved(i)" class="multi-file-upload">
              <el-icon class="el-icon--upload"><upload-filled /></el-icon>
              <div class="el-upload__text">拖拽文件到此 或 <em>点击选择</em></div>
              <template #tip>
                <div class="el-upload__tip">
                  {{ multiFileNames[i] || ('最大 ' + (slot.maxKB || 100) + 'KB，内容将作为文本提交') }}
                </div>
              </template>
            </el-upload>
          </div>
          <div style="text-align: center; margin-top: 12px;">
            <el-button plain @click="$router.push('/ide/' + pid)">
              <el-icon class="el-icon--left">
                <VideoPlay />
              </el-icon>
              在线 IDE
            </el-button>
            <el-button type="primary" :loading="submitting" :disabled="!submitLang" @click="submitMultiFiles">
              <el-icon class="el-icon--left">
                <Upload />
              </el-icon>
              确认提交
            </el-button>
          </div>
        </div>
        <div v-if="isSubmit && !isAnswerProblem && !isMultiSubmit">
          <div style="margin: 10px;">
            选择语言：
            <el-select v-model="submitLang" placeholder="选择语言" style="width: 160px;">
              <el-option v-for="l in this.langList" :key="l.id" :label="l.des" :value="l.id" />
            </el-select>
          </div>
          <el-divider />
          <monacoEditor :value="code" :language="submitEditorLang"
            @update:value="code = $event" />
          <el-divider />
          <el-collapse v-model="runPanelOpen" class="run-collapse">
            <el-collapse-item name="run">
              <template #title>
                <el-icon class="el-icon--left"><VideoPlay /></el-icon>
                自定义输入（自测，不计入提交）
              </template>
              <el-input type="textarea" :rows="5" v-model="runInput"
                placeholder="在此粘贴测试数据，点「运行」查看程序输出 / 用时 / 内存" />
            </el-collapse-item>
          </el-collapse>
          <div style="text-align: center; margin-top: 12px;">
            <el-button :loading="running" :disabled="!submitLang" @click="runCustom">
              <el-icon class="el-icon--left">
                <VideoPlay />
              </el-icon>
              运行
            </el-button>
            <el-button plain @click="$router.push('/ide/' + pid)">
              <el-icon class="el-icon--left">
                <VideoPlay />
              </el-icon>
              在线 IDE
            </el-button>
            <el-button type="primary" :disabled="!submitLang" @click="submit">
              <el-icon class="el-icon--left">
                <Upload />
              </el-icon>
              确认提交
            </el-button>
          </div>
          <div v-if="runResult" class="run-result">
            <el-divider />
            <template v-if="runResult.ce">
              <div class="run-status-row">
                <span class="run-status-badge run-badge-bad">编译错误</span>
              </div>
              <pre class="run-pre run-pre-err">{{ runResult.compileOutput || '(无编译输出)' }}</pre>
            </template>
            <template v-else>
              <div class="run-status-row">
                <span class="run-status-badge" :class="runStatusClass(runResult.status)">{{ runStatusLabel(runResult.status) }}</span>
                <span class="run-meta">用时 {{ runResult.time }} ms · 内存 {{ runResult.memory }} KB · 退出码 {{ runResult.exitCode }}</span>
              </div>
              <div class="run-out-label">标准输出 (stdout)</div>
              <pre class="run-pre">{{ runResult.stdout || '(空)' }}</pre>
              <template v-if="runResult.stderr">
                <div class="run-out-label">标准错误 (stderr)</div>
                <pre class="run-pre run-pre-err">{{ runResult.stderr }}</pre>
              </template>
              <div v-if="runResult.outputTruncated" class="run-trunc">输出过长，仅显示前 64KB</div>
            </template>
          </div>
        </div>
        <div v-if="isSubmit && isAnswerProblem" class="answer-submit">
          <el-upload drag :auto-upload="false" :limit="1" :on-change="onZipPicked"
            :on-remove="onZipRemoved" accept=".zip" class="answer-upload">
            <el-icon class="el-icon--upload"><upload-filled /></el-icon>
            <div class="el-upload__text">拖拽 ZIP 到此 或 <em>点击选择</em></div>
            <template #tip>
              <div class="el-upload__tip">
                ZIP 内文件名按 <code>&lbrace;测试点名&rbrace;.out</code> 匹配,例如 <code>1.out</code>、<code>case1.out</code>。
              </div>
            </template>
          </el-upload>
          <el-divider>或为每个测试点直接输入答案</el-divider>
          <div v-if="answerCases.length === 0" style="text-align: center; color: #909399;">
            题目尚未配置测试点,无法提交。
          </div>
          <div v-for="c in answerCases" :key="c.name" class="answer-case">
            <div class="answer-case-label">测试点 {{ c.name }} <span class="answer-case-sub">(子任务 #{{ c.subtaskId }})</span></div>
            <el-input type="textarea" :rows="6" v-model="answers[c.name]" :placeholder="`测试点 ${c.name} 的答案`" />
          </div>
          <el-divider />
          <div style="text-align: center;">
            <el-button type="primary" :loading="submitting" :disabled="answerCases.length === 0" @click="submitAnswer">
              <el-icon class="el-icon--left">
                <Upload />
              </el-icon>
              确认提交
            </el-button>
          </div>
        </div>
        <ProblemStatement v-if="!isSubmit" :description="problemInfo.description" :samples="samples" />
      </el-card>
    </el-col>
    <el-col :xs="24" :sm="24" :md="7">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <div class="stat-item clickable"
              @click="this.$router.push({ path: '/submission', query: { pid: pid, res: 4, queryAll: true } })">
              <div class="stat-number">{{ problemInfo.acCnt }}</div>
              <div class="stat-label">通过</div>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item clickable"
              @click="this.$router.push({ path: '/submission', query: { pid: pid, queryAll: true } })">
              <div class="stat-number">{{ problemInfo.submitCnt }}</div>
              <div class="stat-label">提交</div>
            </div>
          </div>
        </template>
        <el-descriptions direction="vertical" :column="1" border>
          <el-descriptions-item v-if="!isAnswerProblem" label="时间限制"> {{ problemInfo.timeLimit }} ms</el-descriptions-item>
          <el-descriptions-item v-if="!isAnswerProblem" label="空间限制"> {{ problemInfo.memoryLimit }} MB</el-descriptions-item>
          <el-descriptions-item label="评测方式">
            <el-popover placement="top" :width="300" trigger="hover">
              <template #reference>
                <span class="judge-method">{{ summary.label }}<el-icon class="judge-info">
                    <InfoFilled />
                  </el-icon></span>
              </template>
              <div class="judge-pop">
                <div class="judge-pop-title">{{ summary.label }}</div>
                <div v-if="summary.compare" class="judge-pop-row">评测：{{ summary.compare }}</div>
                <div v-if="summary.submit && summary.submit.length" class="judge-pop-row">
                  需提交：<span v-for="(f, i) in summary.submit" :key="i">{{ f.label }}<span v-if="f.name"
                      class="judge-pop-file">（{{ f.name }}）</span><span
                      v-if="i < summary.submit.length - 1">、</span></span>
                </div>
                <div v-if="judgeNote" class="judge-pop-note">{{ judgeNote }}</div>
              </div>
            </el-popover>
            <el-button v-if="isAnswerProblem" type="success" link :disabled="answerCases.length === 0"
              @click="downloadInputs" style="margin-left: 8px;">
              <el-icon class="el-icon--left">
                <Download />
              </el-icon>
              下载输入数据
            </el-button>
          </el-descriptions-item>
          <el-descriptions-item label="题目标签">
            <el-tag type="info" v-for="tag in problemInfo.tags" :key="tag" :color="getTagColor(tag)"
              @click="this.$router.push({ path: '/problem', query: { tags: JSON.stringify([tag]) } })">
              <span class="tag-text">{{ tag }} </span>
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="难度评级">
            <el-button size="small" :color="levels[problemInfo.level]?.color ?? '#BFBFBF'" :dark="true"
              @click="this.$router.push({ path: '/problem', query: { level: problemInfo.level } })">
              <span style="color: white; font-weight: 600; font-size: 14px;">
                {{ levels[problemInfo.level]?.label ?? '未知难度' }} </span>
            </el-button>
          </el-descriptions-item>
          <el-descriptions-item label="出题人">
            <router-link class="rlink" :to="'/user/' + problemInfo.publisherUid">
              {{ problemInfo.publisher }}
            </router-link>
          </el-descriptions-item>
          <el-descriptions-item label="发布时间"> {{ problemInfo.time }} </el-descriptions-item>
        </el-descriptions>
        <el-divider style="margin-top: 20px; margin-bottom: 20px;" />
        <div class="problem-actions">
          <el-button v-if="!this.isSubmit" type="primary" @click="this.isSubmit = true">
            <el-icon class="el-icon--left">
              <Upload />
            </el-icon>
            提交代码
          </el-button>
          <el-button v-if="this.isSubmit" type="success" @click="this.isSubmit = false">
            <el-icon class="el-icon--left">
              <RefreshLeft />
            </el-icon>
            查看题目
          </el-button>
          <el-button color="#626aef" @click="this.$router.push('/problem/stat/' + problemInfo.pid)">
            <el-icon class="el-icon--left">
              <Histogram />
            </el-icon>
            数据统计
          </el-button>
          <el-button color="#00897b" @click="this.$router.push('/problem/statistics/' + problemInfo.pid + '/fastest')">
            <el-icon class="el-icon--left">
              <DataLine />
            </el-icon>
            统计榜
          </el-button>
          <el-button @click="this.$router.push({ path: '/discussion', query: { pid: problemInfo.pid } })">
            <el-icon class="el-icon--left">
              <Document />
            </el-icon>
            讨论
          </el-button>
          <el-button v-if="canManage" type="danger" @click="this.$router.push('/problem/edit/' + problemInfo.pid)">
            <el-icon class="el-icon--left">
              <Operation />
            </el-icon>
            题目管理
          </el-button>
        </div>
      </el-card>
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios';
import { UploadFilled, Download, VideoPlay, InfoFilled } from '@element-plus/icons-vue';
import monacoEditor from '@/components/monacoEditor.vue'
import ProblemStatement from '@/components/problem/ProblemStatement.vue'

export default {
  name: "problemView",
  computed: {
    canManage() {
      // Use server-side authorization to correctly handle scoped permissions.
      // authInfo comes from getProblemAuth endpoint and is the authoritative source.
      if (this.authInfo && this.authInfo.manage) return true;
      return false;
    },
    problemNumber() {
      return this.problemInfo.pid || this.pid;
    },
    isAnswerProblem() {
      return this.problemInfo.typeId === 2 || this.problemInfo.typeId === 3;
    },
    submitSlots() {
      return this.summary.submit || [];
    },
    samples() {
      return Array.isArray(this.problemInfo.samples) ? this.problemInfo.samples : [];
    },
    // 代码提交槽（源文件）。单槽走普通编辑器；多槽/上传槽走结构化提交。
    sourceSlots() {
      return this.submitSlots.filter((s) => s.kind === 'source');
    },
    isMultiSubmit() {
      return !this.isAnswerProblem && (this.submitSlots.length > 1 || this.submitSlots.some((s) => s.kind === 'file'));
    },
    submitEditorLang() {
      const row = (this.$store.state.langList || {})[this.submitLang];
      return (row && row.lang) || 'cpp';
    },
    // 评测方式摘要：服务端 getProblemInfo 返回 judgeSummary；缺省回退到 type 文本。
    summary() {
      return this.problemInfo.judgeSummary
        || { label: this.problemInfo.type || '—', compare: '', submit: [] };
    },
    judgeNote() {
      return {
        traditional: '将你的程序输出与标准答案逐字符比较。',
        spj: '由出题人提供的校验器判定，可能允许多种正确输出。',
        function: '你只需提交指定函数的实现，由出题人的 grader 调用并评测。',
        interactive: '你的程序与交互器实时通信，按题目协议读写完成评测。',
        communication: '两个进程通过管理器通信协作完成任务。',
        answer: '直接为每个测试点提交输出文件（.out）。',
        'answer-spj': '为每个测试点提交输出文件，由校验器判定。',
        custom: '出题人自定义的评测流程。',
      }[this.summary.kind] || '';
    },
  },
  data() {
    return {
      pid: 0,
      submitLang: null,
      langList: [],
      problemInfo: {},
      authInfo: { view: false, manage: false },
      code: '',
      multiCode: [],
      multiFileNames: [],
      isSubmit: false,
      // custom run (自测)
      runPanelOpen: [],
      runInput: '',
      running: false,
      runResult: null,
      // answer-submission state
      answerCases: [],
      answers: {},
      answerZip: null,
      submitting: false,
      levels: [
        {
          label: '暂未评级',
          color: '#BFBFBF'
        },
        {
          label: '入门',
          color: '#FE4C61'
        },
        {
          label: '普及',
          color: '#FFC116'
        },
        {
          label: '提高',
          color: '#52C41A'
        },
        {
          label: '省选',
          color: '#3498DB'
        },
        {
          label: 'NOI / NOI+',
          color: '#0E1D69'
        },
      ],
      tagColorList: [
        '#2d8cf0',
        '#3f51b5',
        '#9c27b0',
        '#009688',
        '#19be6b',
        '#689f38',
        '#ff9900',
        '#E91E63',
        '#ed4014'
      ],
      tagColorMap: {},
    }
  },
  components: {
    monacoEditor,
    ProblemStatement,
    UploadFilled,
    Download,
    VideoPlay,
    InfoFilled
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
    async loadProblem() {
      this.langList = [];
      await axios.post('/api/problem/getProblemInfo', { pid: this.pid }).then(res => {
        if (res.status === 200) {
          this.problemInfo = res.data.data
          this.pid = this.problemInfo.pid;
          this.problemInfo.isPublic = res.data.data.isPublic ? true : false;
          // Answer-submission problems don't use languages at all; skip the
          // language picker setup and preference warning.
          if (!this.isAnswerProblem) {
            for (let l in this.$store.state.langList) {
              let lid = this.$store.state.langList[l].id;
              if ((1 << lid) & this.problemInfo.lang) {
                this.langList.push(this.$store.state.langList[l]);
                if (!this.submitLang)
                  this.submitLang = lid;
              }
            }
            // Pre-size arrays to profile.submit.files so source/file slots stay aligned.
            this.multiCode = this.submitSlots.map(() => '');
            this.multiFileNames = this.submitSlots.map(() => '');
          } else {
            this.loadAnswerCases();
          }
        }
        else {
          this.$router.push({ path: '/problem' });
          this.$message.error(res.data.message)
        }
      });
      document.title = "题目 — " + this.problemInfo.title;
    },
    submit() {
      if (!this.submitLang) {
        this.$message.error('请选择语言');
        return;
      }
      axios.post('/api/judge/submit', {
        pid: this.pid,
        code: this.code,
        lang: this.submitLang
      }).then(res => {
        if (res.status === 200) {
          this.$router.push('/submission/' + res.data.sid);
        } else {
          this.$message.error('提交失败' + res.data.message);
        }
      });
    },
    setMultiContent(i, value) {
      this.multiCode.splice(i, 1, value);
    },
    onMultiFilePicked(file, i) {
      const raw = file && file.raw;
      const slot = this.submitSlots[i] || {};
      if (!raw) return;
      const cap = (slot.maxKB || 100) * 1024;
      if (raw.size > cap) {
        this.$message.error(`文件「${slot.label || slot.name || ('文件' + (i + 1))}」超出大小限制`);
        this.onMultiFileRemoved(i);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        this.setMultiContent(i, String(reader.result || ''));
        this.multiFileNames.splice(i, 1, raw.name);
      };
      reader.onerror = () => {
        this.$message.error('读取文件失败');
        this.onMultiFileRemoved(i);
      };
      reader.readAsText(raw);
    },
    onMultiFileRemoved(i) {
      this.setMultiContent(i, '');
      this.multiFileNames.splice(i, 1, '');
    },
    submitMultiFiles() {
      if (this.submitting) return;
      if (!this.submitLang) {
        this.$message.error('请选择语言');
        return;
      }
      const files = this.submitSlots.map((_, i) => this.multiCode[i] || '');
      const primaryIndex = this.submitSlots.findIndex((slot) => slot.kind === 'source');
      if (primaryIndex < 0 || !files[primaryIndex]) {
        this.$message.error('请至少填写主文件');
        return;
      }
      for (let i = 0; i < this.submitSlots.length; i++) {
        const slot = this.submitSlots[i];
        if (!slot.optional && !files[i]) {
          this.$message.error(`请填写文件「${slot.label || slot.name || ('文件' + (i + 1))}」`);
          return;
        }
      }
      this.submitting = true;
      axios.post('/api/judge/submitMulti', { pid: this.pid, lang: this.submitLang, files }).then(res => {
        if (res.status === 200 && res.data && res.data.sid) {
          this.$router.push('/submission/' + res.data.sid);
        } else {
          this.$message.error((res.data && res.data.message) || '提交失败');
        }
      }).catch(err => {
        const msg = err && err.response && err.response.data && err.response.data.message;
        this.$message.error(msg || '提交失败');
      }).finally(() => {
        this.submitting = false;
      });
    },
    runCustom() {
      if (this.running) return;
      if (!this.submitLang) {
        this.$message.error('请选择语言');
        return;
      }
      if (!this.code || this.code.length < 1) {
        this.$message.error('请先写代码');
        return;
      }
      this.running = true;
      this.runResult = null;
      if (!this.runPanelOpen.includes('run')) this.runPanelOpen.push('run');
      axios.post('/api/judge/customRun', {
        pid: this.pid,
        code: this.code,
        lang: this.submitLang,
        input: this.runInput
      }).then(res => {
        if (res.status === 200) {
          this.runResult = res.data.data;
        } else {
          this.$message.error((res.data && res.data.message) || '运行失败');
        }
      }).catch(err => {
        const msg = err && err.response && err.response.data && err.response.data.message;
        this.$message.error(msg || err.message || '运行失败');
      }).finally(() => {
        this.running = false;
      });
    },
    runStatusLabel(status) {
      return {
        'Accepted': '运行完成',
        'Time Limit Exceeded': '运行超时',
        'Memory Limit Exceeded': '超出内存',
        'Output Limit Exceeded': '输出超限',
        'Nonzero Exit Status': '运行错误',
        'Signalled': '运行错误',
        'Dangerous Syscall': '非法操作',
        'Internal Error': '评测机异常',
      }[status] || status || '未知';
    },
    runStatusClass(status) {
      return status === 'Accepted' ? 'run-badge-ok' : 'run-badge-bad';
    },
    async loadAnswerCases() {
      try {
        const res = await axios.post('/api/problem/getAnswerCaseList', { pid: this.pid });
        if (res.status === 200 && res.data && res.data.data) {
          this.answerCases = res.data.data;
          const next = {};
          for (const c of this.answerCases) next[c.name] = this.answers[c.name] || '';
          this.answers = next;
        }
      } catch (e) {
        this.$message.error('加载测试点列表失败');
      }
    },
    async downloadInputs() {
      try {
        const res = await axios.post('/api/problem/createFileAccess', {
          pid: this.pid,
          action: 'downloadAnswerInputs',
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
    onZipPicked(file) {
      // el-upload :auto-upload="false" — we hold the raw File until submit.
      this.answerZip = file.raw || null;
    },
    onZipRemoved() {
      this.answerZip = null;
    },
    async submitAnswer() {
      if (this.submitting) return;
      // Drop empty textareas so server-side dedupe (zip wins) sees only real
      // input.
      const trimmed = {};
      for (const k of Object.keys(this.answers)) {
        const v = this.answers[k];
        if (v != null && String(v).length > 0) trimmed[k] = String(v);
      }
      if (!this.answerZip && !Object.keys(trimmed).length) {
        this.$message.error('请上传 ZIP 或在至少一个测试点填入答案');
        return;
      }
      const fd = new FormData();
      fd.append('pid', String(this.pid));
      fd.append('answers', JSON.stringify(trimmed));
      if (this.answerZip) fd.append('file', this.answerZip);
      this.submitting = true;
      try {
        const res = await axios.post('/api/judge/submitAnswer', fd);
        if (res.status === 200 && res.data && res.data.sid) {
          this.$router.push('/submission/' + res.data.sid);
        } else {
          this.$message.error((res.data && res.data.message) || '提交失败');
        }
      } catch (err) {
        const msg = err && err.response && err.response.data && err.response.data.message;
        this.$message.error(msg || err.message || '提交失败');
      } finally {
        this.submitting = false;
      }
    },
    hash(str) {
      let t = 0;
      for (let i = 0; i < str.length; i++)
        t = 31 * t + str.charCodeAt(i);
      return t;
    },
    getTagColor(tag) {
      return this.tagColorMap[tag] || this.tagColorList[this.hash(tag) % this.tagColorList.length];
    },
    async loadTagColors() {
      try {
        const res = await axios.post('/api/problem/getProblemTags', { detail: true });
        if (res.status === 200) {
          const map = {};
          for (const item of (res.data.tags || [])) {
            if (item.color) map[item.name] = item.color;
          }
          this.tagColorMap = map;
        }
      } catch (_) {
        this.tagColorMap = {};
      }
    },
  },
  async mounted() {
    this.pid = this.$route.params.pid;
    await this.ensureLangs();
    await this.loadTagColors();
    await this.loadProblem();
    // Fetch authorization info from server to handle scoped permissions correctly
    await axios.post('/api/problem/getProblemAuth', { pid: this.pid }).then(res => {
      if (res.status === 200) {
        this.authInfo = res.data.data;
      }
    }).catch(() => {
      // If auth fetch fails, authInfo remains { view: false, manage: false }
    });
  }
}
</script>

<style scoped>
.box-card {
  margin: 10px;
  text-align: left;
}

.problem-view-page {
  margin: auto;
  max-width: 1500px;
  min-width: 0;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-around;
}

.stat-item {
  text-align: center;
  flex: 1;
}

.clickable {
  cursor: pointer;
  transition: background-color 0.3s;
  border-radius: 5px;
}

.clickable:hover {
  background-color: #f5f7fa;
}

.stat-number {
  font-size: 28px;
  font-weight: bold;
  color: #303133;
}

.stat-label {
  font-size: 14px;
  color: #909399;
  margin-top: 3px;
}

.stat-divider {
  width: 1px;
  height: 60px;
  background-color: #e0e0e0;
  margin: 0 20px;
}

.title {
  margin: 0;
  font-size: 25px;
}

.el-tag {
  cursor: pointer;
  margin-right: 5px;
}

.tag-text {
  color: white;
  font-weight: 600;
  font-size: 14px;
}

#hidden {
  vertical-align: -4px;
  color: #312b2b;
}

.judge-method {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  color: #303133;
  cursor: help;
}

.judge-info {
  color: #909399;
  font-size: 14px;
}

.judge-pop-title {
  font-weight: 700;
  color: #303133;
  margin-bottom: 6px;
}

.judge-pop-row {
  font-size: 13px;
  color: #606266;
  margin-bottom: 4px;
}

.judge-pop-file {
  color: #909399;
}

.judge-pop-note {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

.multi-submit {
  padding: 0 4px;
}

.multi-slot {
  margin-bottom: 14px;
}

.multi-slot-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
  font-weight: 600;
  color: #303133;
}

.multi-slot-name {
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 400;
  background: #f0f2f5;
  color: #d63384;
  padding: 1px 6px;
  border-radius: 3px;
}

.multi-file-upload :deep(.el-upload),
.multi-file-upload :deep(.el-upload-dragger) {
  width: 100%;
}

.answer-submit {
  padding: 10px;
}

.answer-upload :deep(.el-upload) {
  width: 100%;
}

.answer-upload :deep(.el-upload-dragger) {
  width: 100%;
}

.answer-case {
  margin: 10px 0;
}

.answer-case-label {
  margin-bottom: 4px;
  font-weight: 600;
  color: #303133;
}

.answer-case-sub {
  margin-left: 6px;
  font-weight: 400;
  font-size: 12px;
  color: #909399;
}

.run-collapse {
  margin: 0 4px;
}

.run-result {
  margin: 0 4px;
}

.run-status-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.run-status-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
}

.run-badge-ok {
  background: #f0f9eb;
  color: #19be6b;
  border: 1px solid #b7eb8f;
}

.run-badge-bad {
  background: #fef0f0;
  color: #ed4014;
  border: 1px solid #fbc4c4;
}

.run-meta {
  font-size: 13px;
  color: #909399;
}

.run-out-label {
  font-size: 12px;
  color: #909399;
  margin: 8px 0 4px;
}

.run-pre {
  margin: 0;
  padding: 10px 12px;
  background: #f5f7fa;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  font-family: 'Courier New', Consolas, monospace;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow: auto;
}

.run-pre-err {
  background: #fef6f6;
  border-color: #fde2e2;
  color: #cf1322;
}

.run-trunc {
  margin-top: 6px;
  font-size: 12px;
  color: #e6a23c;
}

.problem-actions {
  text-align: center;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.problem-actions .el-button {
  margin-left: 0;
}

@media (max-width: 768px) {
  .box-card {
    margin: 0 0 10px;
  }

  .card-header {
    justify-content: flex-start;
  }

  .title {
    font-size: 20px;
    line-height: 1.35;
    word-break: break-word;
  }

  .stat-number {
    font-size: 22px;
  }

  .stat-divider {
    margin: 0 12px;
  }

  .run-status-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }

}
</style>
