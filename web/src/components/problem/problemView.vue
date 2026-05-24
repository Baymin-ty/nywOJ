<template>
  <el-row style="margin: auto;max-width: 1500px;min-width: 600px;">
    <el-col :xs="24" :sm="24" :md="17">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header" style="height: 35px;">
            <p class="title">
              #{{ problemInfo.pid }}、{{ problemInfo.title }}
              <el-icon id="hidden" v-if="!problemInfo.isPublic">
                <Hide />
              </el-icon>
            </p>
          </div>
        </template>
        <div v-if="isSubmit && !isAnswerProblem">
          <div style="margin: 10px;">
            选择语言：
            <el-select v-model="submitLang" placeholder="选择语言" style="width: 160px;">
              <el-option v-for="l in this.langList" :key="l.id" :label="l.des" :value="l.id" />
            </el-select>
          </div>
          <el-divider />
          <monacoEditor :value="code" :language="$store.state.langList[submitLang].lang"
            @update:value="code = $event" />
          <el-divider />
          <div style="text-align: center;">
            <el-button type="primary" @click="submit">
              <el-icon class="el-icon--left">
                <Upload />
              </el-icon>
              确认提交
            </el-button>
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
        <v-md-preview v-show="!isSubmit" :text="problemInfo.description"> </v-md-preview>
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
          <el-descriptions-item label="比对方式">
            {{ problemInfo.type }}
            <el-button v-if="isAnswerProblem" type="success" link :disabled="answerCases.length === 0"
              @click="downloadInputs">
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
        <div style="text-align: center;">
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
import { UploadFilled, Download } from '@element-plus/icons-vue';
import monacoEditor from '@/components/monacoEditor.vue'

export default {
  name: "problemView",
  computed: {
    canManage() {
      // Use server-side authorization to correctly handle scoped permissions.
      // authInfo comes from getProblemAuth endpoint and is the authoritative source.
      if (this.authInfo && this.authInfo.manage) return true;
      return false;
    },
    isAnswerProblem() {
      return this.problemInfo.typeId === 2 || this.problemInfo.typeId === 3;
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
      isSubmit: false,
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
    }
  },
  components: {
    monacoEditor,
    UploadFilled,
    Download
  },
  methods: {
    submit() {
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
    downloadInputs() {
      window.location.href = '/api/problem/downloadAnswerInputs?pid=' + this.pid;
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
      return this.tagColorList[this.hash(tag) % this.tagColorList.length];
    },
  },
  async mounted() {
    this.pid = this.$route.params.pid;
    await axios.post('/api/problem/getProblemInfo', { pid: this.pid }).then(res => {
      if (res.status === 200) {
        this.problemInfo = res.data.data
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
              if (lid === this.$store.state.preferenceLang)
                this.submitLang = lid;
            }
          }
          if (!this.$store.state.preferenceLang)
            this.$message.info('可在编辑资料--个人信息中设置您的偏好语言');
          else if (this.submitLang !== this.$store.state.preferenceLang)
            this.$message.warning('本题无法用您的偏好语言提交');
        } else {
          this.loadAnswerCases();
        }
      }
      else {
        this.$router.push({ path: '/problem' });
        this.$message.error(res.data.message)
      }
    });
    // Fetch authorization info from server to handle scoped permissions correctly
    await axios.post('/api/problem/getProblemAuth', { pid: this.pid }).then(res => {
      if (res.status === 200) {
        this.authInfo = res.data.data;
      }
    }).catch(() => {
      // If auth fetch fails, authInfo remains { view: false, manage: false }
    });
    document.title = "题目 — " + this.problemInfo.title;
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
</style>