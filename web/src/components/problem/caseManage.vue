<template>
  <div class="case-page">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <div class="card-title">
            题目数据与评测配置
            <span class="pid-badge">#{{ pid }}</span>
          </div>
          <div class="header-actions">
            <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="重测所有代码?"
              @confirm="reJudgeProblem">
              <template #reference>
                <el-button color="#626aef" plain :disabled="!auth.manage">
                  <el-icon class="el-icon--left">
                    <Refresh />
                  </el-icon>
                  重测整题
                </el-button>
              </template>
            </el-popconfirm>
            <el-button plain @click="downloadCase(0)" :disabled="!auth.manage">
              <el-icon class="el-icon--left">
                <Download />
              </el-icon>
              下载数据
            </el-button>
            <el-button type="success" plain @click="exportProblem" :disabled="!auth.manage">
              <el-icon class="el-icon--left">
                <Download />
              </el-icon>
              导出整题
            </el-button>
            <el-button type="primary" @click="this.$router.push('/problem/edit/' + pid)">
              <el-icon class="el-icon--left">
                <Edit />
              </el-icon>
              编辑题面
            </el-button>
          </div>
        </div>
      </template>

      <div class="overview-strip" v-if="auth.manage">
        <div class="ov-item">
          <span class="ov-label">题型</span>
          <span class="ov-value">{{ health.problemType || '…' }}</span>
        </div>
        <div class="ov-item ov-clickable" @click="activeTab = 'data'">
          <span class="ov-label">测试点</span>
          <span class="ov-value">{{ cases.length }} 个 · {{ subtask.length }} 个子任务</span>
        </div>
        <div class="ov-item ov-clickable" @click="activeTab = 'health'">
          <span class="ov-label">体检</span>
          <el-tag v-if="health.summary && health.summary.error" type="danger" size="small">{{ health.summary.error }} 项错误</el-tag>
          <el-tag v-else-if="health.summary && health.summary.warn" type="warning" size="small">{{ health.summary.warn }} 项警告</el-tag>
          <el-tag v-else type="success" size="small">正常</el-tag>
        </div>
        <div class="ov-flow">建议流程：① 评测流程 → ② 测试数据 → ③ 样例 → ④ 数据体检</div>
      </div>

      <el-tabs v-model="activeTab" class="main-tabs">
        <!-- ============ 评测流程 ============ -->
        <el-tab-pane name="profile">
          <template #label>
            <span class="tab-label"><el-icon><Connection /></el-icon> 评测流程</span>
          </template>
          <judge-profile-designer ref="profileDesigner" :pid="pid" :auth="auth" @saved="onProfileSaved" />
        </el-tab-pane>

        <!-- ============ 测试数据 ============ -->
        <el-tab-pane name="data">
          <template #label>
            <span class="tab-label"><el-icon><Files /></el-icon> 测试数据</span>
          </template>

          <div class="data-section zip-section">
            <div class="section-head">
              <div>
                <h3>ZIP 导入</h3>
                <div class="section-subtitle">上传测试数据包（.in/.out，可含 config.json、checker、assets、nywoj.yaml）。</div>
              </div>
            </div>
            <el-upload v-if="!cases.length" drag action="/api/problem/uploadData" accept=".zip"
              :http-request="uploadDataBySignedUrl" :on-error="handleUploadError" :on-success="reflushData"
              v-loading="!finished" :disabled="!auth.manage">
              <el-icon class="el-icon--upload">
                <UploadFilled />
              </el-icon>
              <div class="el-upload__text">
                Drop file here or <em>click to upload</em>
              </div>
              <template #tip>
                <div class="el-upload__tip">
                  ZIP file with a size less than 200 MB
                </div>
              </template>
            </el-upload>
            <el-alert v-else type="info" :closable="false" title="已有测试数据。如需重新导入 ZIP，请先在下方「数据列表」清空当前数据。" />
          </div>

          <div class="data-section" v-if="cases.length">
            <div class="section-head">
              <div>
                <h3>子任务与计分</h3>
                <div class="section-subtitle">计分方式、测试点归属和 pretest 改完后，点「保存数据配置」生效。</div>
              </div>
              <div class="section-actions">
                <el-button type="warning" plain size="small" @click="addSubtask" :disabled="!auth.manage">
                  <el-icon class="el-icon--left">
                    <CirclePlus />
                  </el-icon>新增计分子任务
                </el-button>
                <el-button type="success" plain size="small" @click="updateSubtaskId" :disabled="!auth.manage">
                  <el-icon class="el-icon--left">
                    <CircleCheck />
                  </el-icon>保存数据配置
                </el-button>
              </div>
            </div>
            <el-table :data="this.subtask" style="padding-bottom: 5px;" :header-cell-style="{ textAlign: 'center' }"
              :cell-style="{ textAlign: 'center' }">
              <el-table-column fixed="left" label="删除" min-width="10%">
                <template #default="scope">
                  <el-button link type="primary" size="small" @click.prevent="this.subtask.splice(scope.$index, 1)">
                    <el-icon>
                      <CloseBold />
                    </el-icon>
                  </el-button>
                </template>
              </el-table-column>
              <el-table-column label="编号" min-width="10%">
                <template #default="scope">
                  <span> {{ scope.row.index }} </span>
                </template>
              </el-table-column>
              <el-table-column label="分数" min-width="25%">
                <template #default="scope">
                  <el-input style="max-width: 120px;" v-model="scope.row.score">
                    <template #append>分</template>
                  </el-input>
                </template>
              </el-table-column>
              <el-table-column label="记分方式" min-width="25%">
                <template #default="scope">
                  <div>
                    <el-radio-group v-model="scope.row.option">
                      <el-radio-button :value="0"
                        @click="scope.row.dependencies = [], scope.row.skip = 0">等分</el-radio-button>
                      <el-radio-button :value="1">全过得分</el-radio-button>
                    </el-radio-group>
                    <br>
                    <el-switch style="margin-top: 5px;" v-if="scope.row.option" v-model="scope.row.skip"
                      active-text="遇TLE止测" inactive-text="全测" />
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="依赖子任务" min-width="30%">
                <template #default="scope">
                  <el-select :disabled="!scope.row.option" v-model="scope.row.dependencies" multiple filterable
                    clearable placeholder="依赖子任务" style="width: 200px;">
                    <el-option v-for="i in scope.row.index - 1" :key="i" :label="i" :value="i" />
                  </el-select>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <div class="cases" v-if="cases.length">
            <div class="section-head">
              <div>
                <h3>数据列表</h3>
                <div class="section-subtitle">测试点预览、子任务绑定与单点编辑。</div>
              </div>
              <div class="section-actions">
                <el-button plain size="small" @click="all()" :disabled="!auth.manage">
                  <el-icon class="el-icon--left">
                    <Refresh />
                  </el-icon>刷新
                </el-button>
                <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认清空全部测试数据?" @confirm="delAllCase">
                  <template #reference>
                    <el-button type="danger" plain size="small" :disabled="!auth.manage">
                      <el-icon class="el-icon--left">
                        <Delete />
                      </el-icon>清空数据
                    </el-button>
                  </template>
                </el-popconfirm>
              </div>
            </div>
            <div v-for="i in cases" :key="i.index" class="case-item">
              <div class="header">
                <span>
                  Case #{{ i.index }}
                </span>
                <el-button :type="(i.edit > 1 ? 'danger' : 'primary')"
                  style="vertical-align: middle; margin-left: 10px;" plain size="small" @click="edit(i)"
                  v-text="i.edit ? (i.edit === 1 ? '取消' : '保存') : '编辑'" :disabled="!auth.manage" />
                <el-button style="vertical-align: middle; margin-left: 8px;" plain size="small" v-text="'下载'"
                  @click="downloadCase(i.index)" :disabled="!auth.manage" />
                <el-checkbox v-model="i.pretest" style="margin-left: 12px; vertical-align: middle;"
                  :disabled="!auth.manage" label="pretest" title="CF 赛制赛中只评 pretest 测试点（保存配置生效）" />
                <div class="subtask">
                  <el-input v-model="i.subtaskId">
                    <template #prepend>
                      <el-popover placement="left" :width="320" trigger="hover">
                        <template #reference>
                          <span>子任务编号</span>
                        </template>
                        <span>将 </span>
                        <el-input v-model="tool.left" style="width: 50px" placeholder="[" />
                        <span> 到 </span>
                        <el-input v-model="tool.right" style="width: 50px" placeholder="]" />
                        <span> 设为 </span>
                        <el-input v-model="tool.id" style="width: 50px" placeholder="id" />
                        <el-button @click="setIds" style="margin-left: 5px;">确定</el-button>
                      </el-popover>
                    </template>
                  </el-input>
                </div>
              </div>
              <el-divider />
              <span class="attach">
                {{ i.inName }} | {{ i.input.size }} | create: {{ i.input.create }} | modified: {{ i.input.modified }}
              </span>
              <el-input type="textarea" @input="i.edit = 2" v-if="i.edit" :autosize="{ minRows: 2, maxRows: 12 }"
                v-model="i.input.content" />
              <pre v-else v-text="i.input.content" />
              <span class="attach">
                {{ i.outName }} | {{ i.output.size }} | create: {{ i.output.create }} | modified: {{ i.output.modified }}
              </span>
              <el-input type="textarea" @input="i.edit = 2" v-if="i.edit" :autosize="{ minRows: 2, maxRows: 12 }"
                v-model="i.output.content" />
              <pre v-else v-text="i.output.content" />
            </div>
          </div>
        </el-tab-pane>

        <!-- ============ 在线造数据 ============ -->
        <el-tab-pane name="onlineData">
          <template #label>
            <span class="tab-label"><el-icon><Edit /></el-icon> 在线造数据</span>
          </template>
          <problem-data-generator-panel
            :pid="pid"
            :auth="auth"
            :has-existing-data="!!cases.length"
            @saved="onGeneratedDataSaved"
          />
        </el-tab-pane>

        <!-- ============ 样例 ============ -->
        <el-tab-pane name="samples">
          <template #label>
            <span class="tab-label"><el-icon><Document /></el-icon> 样例</span>
          </template>
          <div class="sample-panel" v-loading="sampleLoading">
            <div class="sample-toolbar">
              <el-button type="primary" plain @click="addSample" :disabled="!auth.manage">
                <el-icon class="el-icon--left">
                  <CirclePlus />
                </el-icon>新增样例
              </el-button>
              <el-button type="success" plain @click="saveSamples" :disabled="!auth.manage">
                <el-icon class="el-icon--left">
                  <CircleCheck />
                </el-icon>保存样例
              </el-button>
              <el-button plain @click="loadSamples" :disabled="!auth.manage">
                <el-icon class="el-icon--left">
                  <Refresh />
                </el-icon>刷新
              </el-button>
            </div>
            <el-empty v-if="!samples.length && !sampleLoading" description="暂无样例" :image-size="80" />
            <div v-for="(sample, index) in samples" :key="sample.key" class="sample-editor">
              <div class="sample-editor-head">
                <div class="sample-editor-title">样例 #{{ index + 1 }}</div>
                <div class="sample-editor-actions">
                  <el-button size="small" plain :disabled="index === 0" @click="moveSample(index, -1)">上移</el-button>
                  <el-button size="small" plain :disabled="index === samples.length - 1" @click="moveSample(index, 1)">下移</el-button>
                  <el-button size="small" type="danger" plain @click="removeSample(index)">删除</el-button>
                </div>
              </div>
              <div class="sample-editor-grid">
                <div>
                  <div class="sample-editor-label">输入</div>
                  <el-input type="textarea" v-model="sample.inputData" :autosize="{ minRows: 5, maxRows: 14 }"
                    placeholder="样例输入" />
                </div>
                <div>
                  <div class="sample-editor-label">输出</div>
                  <el-input type="textarea" v-model="sample.outputData" :autosize="{ minRows: 5, maxRows: 14 }"
                    placeholder="样例输出，可留空" />
                </div>
              </div>
            </div>
          </div>
        </el-tab-pane>

        <!-- ============ 数据体检 ============ -->
        <el-tab-pane name="health">
          <template #label>
            <span class="tab-label"><el-icon><FirstAidKit /></el-icon> 数据体检</span>
          </template>
          <div class="health-panel" v-loading="healthLoading">
            <div class="health-summary">
              <div>
                <div class="health-title">数据体检</div>
                <div class="health-subtitle">{{ health.problemType || '未知题型' }}</div>
              </div>
              <div class="health-counts">
                <el-tag type="danger">错误 {{ health.summary?.error || 0 }}</el-tag>
                <el-tag type="warning">警告 {{ health.summary?.warn || 0 }}</el-tag>
                <el-tag type="success">正常 {{ health.summary?.ok || 0 }}</el-tag>
                <el-button size="small" plain @click="loadHealth" :disabled="!auth.manage">重新体检</el-button>
              </div>
            </div>
            <el-empty v-if="!health.checks?.length && !healthLoading" description="暂无体检结果" :image-size="80" />
            <div v-else class="health-list">
              <div v-for="(item, idx) in health.checks" :key="idx" class="health-item" :class="'health-' + item.level">
                <el-tag size="small" :type="healthTagType(item.level)">{{ healthLabel(item.level) }}</el-tag>
                <div class="health-copy">
                  <div class="health-item-title">{{ item.title }}</div>
                  <div class="health-detail">{{ item.detail }}</div>
                </div>
              </div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script>
import axios from 'axios';
import judgeProfileDesigner from '@/components/problem/judge/judgeProfileDesigner.vue';
import problemDataGeneratorPanel from '@/components/problem/problemDataGeneratorPanel.vue';

const CASE_TABS = ['profile', 'data', 'onlineData', 'samples', 'health'];

export default {
  name: "problemCaseManage",
  components: { judgeProfileDesigner, problemDataGeneratorPanel },
  data() {
    return {
      pid: 0,
      activeTab: 'profile',
      cases: [],
      finished: false,
      subtask: [],
      samples: [],
      sampleLoading: false,
      auth: {},
      health: { problemType: '', checks: [], summary: { error: 0, warn: 0, ok: 0 } },
      healthLoading: false,
      tool: {
        left: null,
        right: null,
        id: null
      }
    };
  },
  watch: {
    activeTab(tab) {
      this.syncTabToRoute(tab);
    },
    '$route.query.tab'(tab) {
      const normalized = this.normalizeTab(tab);
      if (normalized !== this.activeTab) this.activeTab = normalized;
      else this.syncTabToRoute(normalized);
    }
  },
  methods: {
    normalizeTab(tab) {
      const raw = Array.isArray(tab) ? tab[0] : tab;
      if (raw === 'manualData') return 'onlineData';
      return CASE_TABS.includes(raw) ? raw : 'profile';
    },
    syncTabToRoute(tab) {
      const normalized = this.normalizeTab(tab);
      if (this.$route.query.tab === normalized) return;
      this.$router.replace({
        path: this.$route.path,
        query: { ...this.$route.query, tab: normalized }
      });
    },
    onProfileSaved() {
      // 题型/checker 改变后体检结论会变，刷新一次
      this.loadHealth();
    },
    onGeneratedDataSaved() {
      this.all(2);
      this.loadHealth();
    },
    delAllCase() {
      axios.post('/api/problem/clearCase', {
        pid: this.pid,
      }).then(res => {
        if (res.status !== 200) {
          this.$message.error(res.data.message);
        } else {
          this.$message.success('数据已清空');
          this.all();
          this.loadHealth();
        }
      });
    },
    all(op) {
      this.finished = false;
      axios.post('/api/problem/getProblemCasePreview', {
        pid: this.pid,
      }).then(res => {
        for (let i of res.data.subtask)
          if (!i.dependencies) i.dependencies = [];
        this.cases = res.data.data;
        this.subtask = res.data.subtask;
        if (!this.cases.length && op) {
          this.$message.error((op === 1 ? '数据还未上传' : '数据未处理完成或数据格式错误，请手动刷新或重新上传数据'));
        }
        this.finished = true;
      });
    },
    async reflushData(res) {
      if (res.err) {
        this.$message.error('上传错误' + res.err);
      }
      else {
        const imported = [];
        if (res.configImported) imported.push('测试点配置');
        if (res.profileImported) imported.push('评测流程');
        this.$message.success(imported.length ? `上传成功，已导入${imported.join('、')}` : '上传成功');
        if (res.profileImported) {
          const designer = this.$refs.profileDesigner;
          if (designer && designer.load) designer.load();
        }
        this.all(2);
        this.loadHealth();
      }
    },
    loadHealth() {
      if (!this.pid || !this.auth.manage) return;
      this.healthLoading = true;
      axios.post('/api/problem/getProblemCaseHealth', { pid: this.pid }).then(res => {
        if (res.status === 200) {
          this.health = res.data.data || this.health;
        } else {
          this.$message.error(res.data.message || '数据体检失败');
        }
      }).catch(err => {
        this.$message.error('数据体检失败' + err.message);
      }).finally(() => {
        this.healthLoading = false;
      });
    },
    healthTagType(level) {
      return { error: 'danger', warn: 'warning', ok: 'success' }[level] || 'info';
    },
    healthLabel(level) {
      return { error: '错误', warn: '警告', ok: '正常' }[level] || level;
    },
    reJudgeProblem() {
      axios.post('/api/judge/reJudgeProblem', {
        pid: this.pid,
      }).then(res => {
        if (res.data.total > 0) {
          this.$router.push({ path: '/problem/stat/' + this.pid });
        } else {
          this.$message.error('暂时无人提交');
        }
      });
    },
    updateSubtaskId() {
      for (let i in this.cases)
        if (!this.cases[i].subtaskId)
          this.cases[i].subtaskId = 0;
      for (let i in this.subtask)
        this.subtask[i].score = Number(this.subtask[i].score);
      axios.post('/api/problem/updateSubtaskId', {
        subtask: this.subtask,
        pid: this.pid,
        cases: this.cases
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('数据配置已保存');
          this.all();
          this.loadHealth();
        } else {
          this.$message.error('保存数据配置失败' + res.data.message);
        }
      })
    },
    addSubtask() {
      if (!this.subtask.length) {
        this.subtask.push({
          index: 1,
          score: 0,
          option: 1
        });
      } else {
        this.subtask.push({
          index: this.subtask[this.subtask.length - 1].index + 1,
          score: 0,
          option: 1
        });
      }
    },
    sampleKey() {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    },
    normalizeSamplesForView(samples) {
      return (Array.isArray(samples) ? samples : []).map(sample => ({
        key: this.sampleKey(),
        inputData: String(sample && sample.inputData != null ? sample.inputData : ''),
        outputData: String(sample && sample.outputData != null ? sample.outputData : ''),
      }));
    },
    loadSamples() {
      if (!this.pid || !this.auth.manage) return;
      this.sampleLoading = true;
      axios.post('/api/problem/getProblemSamples', { pid: this.pid }).then(res => {
        if (res.status === 200) {
          this.samples = this.normalizeSamplesForView(res.data.samples || []);
        } else {
          this.$message.error(res.data.message || '加载样例失败');
        }
      }).catch(err => {
        this.$message.error('加载样例失败' + err.message);
      }).finally(() => {
        this.sampleLoading = false;
      });
    },
    addSample() {
      this.samples.push({ key: this.sampleKey(), inputData: '', outputData: '' });
    },
    removeSample(index) {
      this.samples.splice(index, 1);
    },
    moveSample(index, delta) {
      const next = index + delta;
      if (next < 0 || next >= this.samples.length) return;
      const item = this.samples.splice(index, 1)[0];
      this.samples.splice(next, 0, item);
    },
    saveSamples() {
      const samples = this.samples.map(sample => ({
        inputData: sample.inputData || '',
        outputData: sample.outputData || '',
      }));
      this.sampleLoading = true;
      axios.post('/api/problem/updateProblemSamples', {
        pid: this.pid,
        samples
      }).then(res => {
        if (res.status === 200) {
          this.samples = this.normalizeSamplesForView(res.data.samples || []);
          this.$message.success('样例已保存');
        } else {
          this.$message.error(res.data.message || '保存样例失败');
        }
      }).catch(err => {
        this.$message.error('保存样例失败' + err.message);
      }).finally(() => {
        this.sampleLoading = false;
      });
    },
    edit(i) {
      if (!i.edit) {
        axios.post('/api/problem/getCase', {
          pid: this.pid,
          caseInfo: {
            inName: i.inName,
            outName: i.outName
          }
        }).then(res => {
          if (res.status === 200) {
            i.edit = 1;
            i.input.content = res.data.input;
            i.output.content = res.data.output;
          } else {
            this.$message.error(res.data.message);
          }
        });
      } else {
        if (i.edit === 1) {
          i.edit = 0;
          return;
        }
        axios.post('/api/problem/updateCase', {
          pid: this.pid,
          caseInfo: i
        }).then(res => {
          if (res.status === 200) {
            i.edit = 0;
            i.input.modified = res.data.inputM;
            i.output.modified = res.data.outputM;
            this.$message.success('保存成功');
          } else {
            this.$message.error('保存失败' + res.data.message);
          }
        });
      }
    },
    async createFileAccess(action, extra = {}) {
      const res = await axios.post('/api/problem/createFileAccess', {
        pid: this.pid,
        action,
        ...extra
      });
      if (res.status !== 200 || !res.data || !res.data.url) {
        throw new Error((res.data && res.data.message) || '签发文件访问链接失败');
      }
      return res.data;
    },
    async uploadDataBySignedUrl(option) {
      try {
        const access = await this.createFileAccess('uploadData');
        const form = new FormData();
        form.append('file', option.file);
        const res = await axios.post(access.url, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (event) => {
            if (event.total && option.onProgress) {
              option.onProgress({ percent: Math.round(event.loaded / event.total * 100) });
            }
          }
        });
        if (res.status === 200) option.onSuccess(res.data);
        else option.onError(new Error((res.data && (res.data.err || res.data.message)) || '上传失败'));
      } catch (err) {
        option.onError(err);
      }
    },
    async downloadCase(index) {
      try {
        const access = await this.createFileAccess('downloadCase', { index: index || 0 });
        window.location.href = access.url;
      } catch (err) {
        this.$message.error(err.message || '下载失败');
      }
    },
    async exportProblem() {
      try {
        const access = await this.createFileAccess('exportProblem');
        window.location.href = access.url;
      } catch (err) {
        this.$message.error(err.message || '导出题目失败');
      }
    },
    handleUploadError(err) {
      this.$message.error('上传失败' + err);
    },
    setIds() {
      this.tool.left = Number(this.tool.left);
      this.tool.right = Number(this.tool.right);
      this.tool.id = Number(this.tool.id)
      if (this.tool.left > this.tool.right ||
        this.tool.left < 1 || this.tool.right > this.cases.length ||
        this.tool.id < 1 || this.tool.id > this.subtask.length) {
        this.$message.error('out of range');
        return;
      }
      for (let i = this.tool.left - 1; i < this.tool.right; i++)
        this.cases[i].subtaskId = this.tool.id;
      this.$message.success('设置成功');
    }
  },
  created() {
    // Set pid before children mount so the embedded designer loads with the
    // real pid (not 0) on its immediate pid-watcher.
    this.pid = this.$route.params.pid;
    this.activeTab = this.normalizeTab(this.$route.query.tab);
    this.syncTabToRoute(this.activeTab);
  },
  mounted() {
    axios.post('/api/problem/getProblemAuth', {
      pid: this.pid,
    }).then(res => {
      this.auth = res.data.data;
      if (!this.auth.manage) {
        this.$router.push(`/problem/${this.pid}`);
      } else {
        this.loadHealth();
        this.loadSamples();
      }
    });
    this.all(1);
  }
}
</script>

<style scoped>
.box-card {
  margin: 10px;
  text-align: left;
}

.case-page {
  text-align: center;
  margin: 0 auto;
  width: 100%;
  max-width: 1480px;
  min-width: 0;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.card-title {
  font-size: 16px;
  font-weight: 700;
  color: #303133;
}

.pid-badge {
  margin-left: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #909399;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.main-tabs {
  margin-top: -6px;
}

.overview-strip {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 22px;
  padding: 10px 14px;
  margin-bottom: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%);
}

.ov-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ov-clickable {
  cursor: pointer;
}

.ov-clickable:hover .ov-value {
  color: #409eff;
}

.ov-label {
  font-size: 12px;
  font-weight: 700;
  color: #94a3b8;
}

.ov-value {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.ov-flow {
  margin-left: auto;
  font-size: 12px;
  color: #64748b;
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.data-section,
.cases {
  padding: 14px;
  margin-bottom: 16px;
  text-align: left;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  background: #fff;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.section-head h3 {
  margin: 0;
  color: #303133;
  font-size: 18px;
  line-height: 1.35;
}

.section-subtitle {
  margin-top: 2px;
  color: #606266;
  font-size: 13px;
}

.sample-panel {
  text-align: left;
}

.sample-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.sample-editor {
  padding: 12px 0 16px;
  border-top: 1px solid #ebeef5;
}

.sample-editor:first-of-type {
  border-top: 0;
}

.sample-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.sample-editor-title {
  font-size: 16px;
  font-weight: 700;
  color: #303133;
}

.sample-editor-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.sample-editor-actions .el-button {
  margin-left: 0;
}

.sample-editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.sample-editor-label {
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 700;
  color: #606266;
}

.header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 5px;
  font-size: 18px;
  font-weight: 800;
}

.attach {
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 14px;
  font-weight: 500;
  color: #585858;
}

pre {
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  display: block;
  max-height: 160px;
  overflow: auto;
  padding: 10px;
  margin: 10px 0;
  font-size: 14px;
  font-weight: 400;
  line-height: 1;
  word-break: break-all;
  word-wrap: break-word;
  color: #333;
  background-color: #f5f5f5;
  border: 1px solid #ccc;
  border-radius: 4px;
}

:deep(textarea) {
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  display: block;
  overflow: auto;
  padding: 10px;
  margin: 10px 0;
  font-size: 14px;
  font-weight: 400;
  line-height: 1;
  word-break: break-all;
  word-wrap: break-word;
  color: #333;
}

.case-item {
  padding: 12px 0 14px;
  border-top: 1px solid #ebeef5;
}

.case-item:first-of-type {
  border-top: 0;
}

.subtask {
  width: 190px;
  margin-left: auto;
}

.health-panel {
  text-align: left;
}

.health-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.health-title {
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}

.health-subtitle {
  margin-top: 2px;
  font-size: 12px;
  color: #909399;
}

.health-counts {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.health-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.health-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 9px 10px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fff;
}

.health-error {
  background: #fef0f0;
  border-color: #fbc4c4;
}

.health-warn {
  background: #fdf6ec;
  border-color: #faecd8;
}

.health-ok {
  background: #f0f9eb;
  border-color: #e1f3d8;
}

.health-copy {
  min-width: 0;
}

.health-item-title {
  font-weight: 700;
  color: #303133;
}

.health-detail {
  margin-top: 2px;
  font-size: 12px;
  color: #606266;
  line-height: 1.45;
  word-break: break-word;
}

@media (max-width: 768px) {
  .case-page {
    width: 100%;
  }

  .box-card {
    margin: 0;
  }

  .card-header,
  .header-actions,
  .section-head,
  .section-actions {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .header-actions,
  .section-actions {
    width: 100%;
  }

  .data-section,
  .cases {
    padding: 10px;
  }

  .overview-strip {
    align-items: flex-start;
    padding: 10px;
  }

  .ov-flow {
    flex-basis: 100%;
    margin-left: 0;
  }

  .health-summary {
    align-items: flex-start;
    flex-direction: column;
  }

  .health-counts {
    justify-content: flex-start;
  }

  .health-list {
    grid-template-columns: 1fr;
  }

  .sample-editor-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .sample-editor-actions {
    justify-content: flex-start;
  }

  .sample-editor-grid {
    grid-template-columns: 1fr;
  }

  .subtask {
    width: 100%;
    margin-left: 0;
    margin-top: 8px;
  }
}
</style>
