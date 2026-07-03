<template>
  <section v-if="draft" class="generator-panel">
    <div class="generator-head">
      <div>
        <div class="eyebrow">在线造数据</div>
        <h3>生成测试数据</h3>
        <div class="subline">在线编辑 generator、STD 和生成计划，先预览再写入 OJ。</div>
      </div>
      <div class="head-actions">
        <el-tag v-if="hasExistingData" type="warning" effect="plain">已有数据</el-tag>
        <el-tag v-else type="info" effect="plain">空数据</el-tag>
        <el-button plain :loading="previewing" :disabled="!auth.manage" @click="previewData">
          <el-icon class="el-icon--left"><View /></el-icon>
          运行预览
        </el-button>
        <el-button type="primary" :loading="saving" :disabled="!auth.manage" @click="saveData">
          <el-icon class="el-icon--left"><CircleCheck /></el-icon>
          生成并写入
        </el-button>
      </div>
    </div>

    <div class="online-guide">
      <div class="guide-step">
        <span class="guide-index">1</span>
        <div>
          <strong>导入方案</strong>
          <p>上传源码或粘贴 JSON，也可以直接在下方编辑。</p>
        </div>
      </div>
      <div class="guide-step">
        <span class="guide-index">2</span>
        <div>
          <strong>配置生成点</strong>
          <p>每个点运行一次 generator，参数写规模、seed 和特殊性质。</p>
        </div>
      </div>
      <div class="guide-step">
        <span class="guide-index">3</span>
        <div>
          <strong>预览后写入</strong>
          <p>预览会真实运行 generator + STD，只展示截断内容和大小。</p>
        </div>
      </div>
    </div>

    <div class="tool-panel source-panel">
      <div class="panel-line">
        <strong>导入源码 / JSON</strong>
        <div class="upload-row">
          <el-upload
            action="#"
            accept=".cpp,.cc,.cxx"
            :auto-upload="false"
            :show-file-list="false"
            :on-change="(file) => loadSourceFile(file, 'generator')"
          >
            <el-button plain>
              <el-icon class="el-icon--left"><Upload /></el-icon>
              上传 Generator
            </el-button>
          </el-upload>
          <el-upload
            action="#"
            accept=".cpp,.cc,.cxx"
            :auto-upload="false"
            :show-file-list="false"
            :on-change="(file) => loadSourceFile(file, 'std')"
          >
            <el-button plain>
              <el-icon class="el-icon--left"><Upload /></el-icon>
              上传 STD
            </el-button>
          </el-upload>
          <el-button plain @click="rawJson = exportDraftJson()">
            <el-icon class="el-icon--left"><Document /></el-icon>
            导出 JSON
          </el-button>
          <el-button type="primary" plain @click="parseJsonDraft">
            <el-icon class="el-icon--left"><CircleCheck /></el-icon>
            解析 JSON
          </el-button>
        </div>
      </div>
      <el-input
        v-model="rawJson"
        type="textarea"
        class="json-input"
        :autosize="{ minRows: 4, maxRows: 10 }"
        placeholder="可粘贴完整 { std, data } JSON，或只粘贴 data 对象；也可以留空直接编辑下面的源码和生成点。"
      />
    </div>

    <div class="editor-grid">
      <div class="tool-panel">
        <div class="panel-line">
          <strong>Generator</strong>
          <el-input v-model="draft.data.generator.fileName" class="file-input" placeholder="ai-generator.cpp" />
        </div>
        <monaco-editor
          v-model:value="draft.data.generator.source"
          :language="generatorLanguage"
          :height="300"
          :font-size="14"
        />
      </div>
      <div class="tool-panel">
        <div class="panel-line">
          <strong>STD</strong>
          <el-input v-model="draft.std.fileName" class="file-input" placeholder="std.cpp" />
        </div>
        <monaco-editor v-model:value="draft.std.source" :language="stdLanguage" :height="300" :font-size="14" />
      </div>
    </div>

    <div class="plan-grid">
      <div class="tool-panel">
        <div class="panel-line">
          <strong>生成点</strong>
          <el-button plain size="small" @click="addGenerationCase">
            <el-icon class="el-icon--left"><CirclePlus /></el-icon>
            新增
          </el-button>
        </div>
        <el-empty v-if="!draft.data.generation.cases.length" description="暂无生成点" :image-size="70" />
        <div v-else class="gen-list">
          <div v-for="(item, index) in draft.data.generation.cases" :key="item.key" class="gen-row">
            <el-input v-model="item.name" class="case-name" placeholder="名称" />
            <el-input-number v-model="item.subtaskId" :min="1" :max="100" controls-position="right" />
            <el-input v-model="item.argsText" class="case-args" placeholder="参数，以空格分隔" />
            <el-input v-model="item.note" class="case-note" placeholder="备注" />
            <el-button link type="danger" @click="removeGenerationCase(index)">删除</el-button>
          </div>
        </div>
      </div>

      <div class="tool-panel">
        <div class="panel-line">
          <strong>子任务</strong>
          <el-button plain size="small" @click="addSubtask">
            <el-icon class="el-icon--left"><CirclePlus /></el-icon>
            新增
          </el-button>
        </div>
        <div class="subtask-list">
          <div v-for="(item, index) in draft.data.subtasks" :key="item.key" class="subtask-row">
            <span class="subtask-index">#{{ item.index }}</span>
            <el-input-number v-model="item.score" :min="1" :max="100" controls-position="right" />
            <el-select v-model="item.option" class="option-select">
              <el-option label="等分" :value="0" />
              <el-option label="全过得分" :value="1" />
            </el-select>
            <el-switch v-if="item.option" v-model="item.skip" active-text="遇 TLE 止测" inactive-text="全测" />
            <el-button link type="danger" :disabled="draft.data.subtasks.length === 1" @click="removeSubtask(index)">
              删除
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <el-collapse class="manual-collapse">
      <el-collapse-item name="manual">
        <template #title>
          <span class="collapse-title">静态数据（可选）</span>
        </template>
        <div class="panel-line">
          <strong>静态输入输出</strong>
          <el-button plain size="small" @click="addManualCase">
            <el-icon class="el-icon--left"><CirclePlus /></el-icon>
            新增
          </el-button>
        </div>
        <el-empty v-if="!draft.data.cases.length" description="暂无静态 Case" :image-size="70" />
        <div v-else class="manual-list">
          <div v-for="(item, index) in draft.data.cases" :key="item.key" class="manual-row">
            <div class="manual-head">
              <el-input v-model="item.name" class="case-name" placeholder="名称" />
              <el-input-number v-model="item.subtaskId" :min="1" :max="100" controls-position="right" />
              <el-button link type="danger" @click="removeManualCase(index)">删除</el-button>
            </div>
            <div class="manual-cols">
              <el-input type="textarea" v-model="item.input" :autosize="{ minRows: 4, maxRows: 10 }" placeholder="输入" />
              <el-input type="textarea" v-model="item.output" :autosize="{ minRows: 4, maxRows: 10 }" placeholder="输出" />
            </div>
          </div>
        </div>
      </el-collapse-item>
    </el-collapse>

    <div v-if="preview.cases.length" class="preview-panel">
      <div class="panel-line">
        <strong>运行预览</strong>
        <el-tag type="success" effect="plain">{{ preview.cases.length }} 个测试点</el-tag>
        <el-tag effect="plain">总量 {{ formatBytes(preview.totalBytes) }}</el-tag>
      </div>
      <el-table :data="preview.cases" class="preview-table" border>
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
  </section>
</template>

<script>
import axios from 'axios';
import { ElMessageBox } from 'element-plus';
import monacoEditor from '@/components/monacoEditor.vue';

export default {
  name: 'problemDataGeneratorPanel',
  components: { monacoEditor },
  props: {
    pid: {
      type: [Number, String],
      required: true,
    },
    auth: {
      type: Object,
      default: () => ({}),
    },
    hasExistingData: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['saved'],
  data() {
    return {
      rawJson: '',
      previewing: false,
      saving: false,
      preview: { cases: [], totalBytes: 0, sandboxGenerated: false },
      draft: null,
    };
  },
  computed: {
    generatorLanguage() {
      return this.editorLanguageOf(this.draft.data.generator.fileName);
    },
    stdLanguage() {
      return this.editorLanguageOf(this.draft.std.fileName);
    },
  },
  created() {
    this.draft = this.emptyDraft();
  },
  methods: {
    key() {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    },
    emptyDraft() {
      return {
        std: { language: 'cpp', fileName: 'std.cpp', source: '', explanation: '' },
        data: {
          cases: [],
          subtasks: [{ key: this.key(), index: 1, score: 100, option: 0, skip: false, dependencies: [] }],
          generator: { language: 'cpp', fileName: 'ai-generator.cpp', source: '', explanation: '' },
          generation: {
            mode: 'per-case-stdout',
            cases: [{ key: this.key(), name: '1', subtaskId: 1, argsText: 'seed=1', stdin: '', note: '' }],
            compile: 'g++ -O2 -std=c++14 ai-generator.cpp -o ai-generator',
            run: './ai-generator <name> <index> <subtaskId> <args...>',
            output: 'generator stdout -> .in, STD stdout -> .out',
            notes: '',
          },
          notes: '',
        },
      };
    },
    editorLanguageOf(value) {
      const text = String(value || '').toLowerCase();
      if (text.endsWith('.py') || text.includes('python')) return 'python';
      if (text.endsWith('.java') || text.includes('java')) return 'java';
      if (text.endsWith('.js') || text.includes('javascript')) return 'javascript';
      return 'cpp';
    },
    normalizeDraft(raw) {
      const base = this.emptyDraft();
      const payload = raw || {};
      const std = payload.std || payload.standard || {};
      const data = payload.data || payload;
      const generation = data.generation || data.generationPlan || {};
      base.std = {
        ...base.std,
        ...std,
        fileName: String(std.fileName || std.name || base.std.fileName),
        source: String(std.source || std.content || ''),
      };
      base.data = {
        ...base.data,
        ...data,
        generator: {
          ...base.data.generator,
          ...(data.generator || {}),
          fileName: String((data.generator && (data.generator.fileName || data.generator.name)) || base.data.generator.fileName),
          source: String((data.generator && (data.generator.source || data.generator.content)) || ''),
        },
        generation: {
          ...base.data.generation,
          ...generation,
          cases: (Array.isArray(generation.cases) ? generation.cases : []).map((item, index) => {
            const args = Array.isArray(item && item.args)
              ? item.args.map(arg => String(arg))
              : String(item && item.args || '').split(/\s+/).filter(Boolean);
            return {
              key: this.key(),
              name: String(item && item.name || index + 1),
              subtaskId: Number(item && item.subtaskId) || 1,
              argsText: args.join(' '),
              stdin: String(item && item.stdin || ''),
              note: String(item && (item.note || item.description) || ''),
            };
          }),
        },
        cases: (Array.isArray(data.cases) ? data.cases : []).map((item, index) => ({
          key: this.key(),
          name: String(item && item.name || index + 1),
          input: String(item && item.input != null ? item.input : ''),
          output: String(item && item.output != null ? item.output : ''),
          subtaskId: Number(item && item.subtaskId) || 1,
        })),
        subtasks: Array.isArray(data.subtasks) && data.subtasks.length
          ? data.subtasks.map((item, index) => ({
            key: this.key(),
            index: index + 1,
            score: Number(item && item.score) || 100,
            option: Number(item && item.option) === 1 ? 1 : 0,
            skip: !!(item && item.skip),
            dependencies: Array.isArray(item && item.dependencies) ? item.dependencies : [],
          }))
          : base.data.subtasks,
        notes: String(data.notes || ''),
      };
      if (!base.data.generation.cases.length && !base.data.cases.length) {
        base.data.generation.cases = [{ key: this.key(), name: '1', subtaskId: 1, argsText: 'seed=1', stdin: '', note: '' }];
      }
      return base;
    },
    applyDraft(raw) {
      this.draft = this.normalizeDraft(raw);
      this.preview = { cases: [], totalBytes: 0, sandboxGenerated: false };
    },
    stripJsonFence(text) {
      const value = String(text || '').trim();
      const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      return match ? match[1].trim() : value;
    },
    parseJsonDraft() {
      if (!this.rawJson.trim()) {
        this.$message.error('请先粘贴 JSON');
        return;
      }
      try {
        const payload = JSON.parse(this.stripJsonFence(this.rawJson));
        this.applyDraft(payload.data || payload.std ? payload : { data: payload, std: payload.std || this.draft.std });
        this.$message.success('JSON 已解析');
      } catch (err) {
        this.$message.error(`JSON 格式错误：${err.message}`);
      }
    },
    exportDraftJson() {
      return JSON.stringify({ std: this.draft.std, data: this.dataPayload() }, null, 2);
    },
    async loadSourceFile(file, target) {
      const raw = file && (file.raw || file);
      if (!raw) return;
      try {
        const text = typeof raw.text === 'function'
          ? await raw.text()
          : await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = reject;
            reader.readAsText(raw);
          });
        if (target === 'generator') {
          this.draft.data.generator.fileName = raw.name || this.draft.data.generator.fileName;
          this.draft.data.generator.source = text;
        } else {
          this.draft.std.fileName = raw.name || this.draft.std.fileName;
          this.draft.std.source = text;
        }
        this.$message.success(`${raw.name || '文件'} 已载入`);
      } catch (err) {
        this.$message.error(`读取文件失败：${err.message}`);
      }
    },
    addGenerationCase() {
      const index = this.draft.data.generation.cases.length + 1;
      this.draft.data.generation.cases.push({
        key: this.key(),
        name: String(index),
        subtaskId: 1,
        argsText: `seed=${index}`,
        stdin: '',
        note: '',
      });
    },
    removeGenerationCase(index) {
      this.draft.data.generation.cases.splice(index, 1);
    },
    addSubtask() {
      const index = this.draft.data.subtasks.length + 1;
      this.draft.data.subtasks.push({ key: this.key(), index, score: 0, option: 1, skip: false, dependencies: [] });
    },
    removeSubtask(index) {
      this.draft.data.subtasks.splice(index, 1);
      this.draft.data.subtasks.forEach((item, idx) => { item.index = idx + 1; });
    },
    addManualCase() {
      const index = this.draft.data.cases.length + 1;
      this.draft.data.cases.push({ key: this.key(), name: String(index), input: '', output: '', subtaskId: 1 });
    },
    removeManualCase(index) {
      this.draft.data.cases.splice(index, 1);
    },
    dataPayload() {
      return {
        ...this.draft.data,
        subtasks: this.draft.data.subtasks.map((item, index) => ({
          index: index + 1,
          score: Number(item.score) || 0,
          option: Number(item.option) || 0,
          skip: !!item.skip,
          dependencies: Array.isArray(item.dependencies) ? item.dependencies : [],
        })),
        cases: this.draft.data.cases.map(item => ({
          name: item.name,
          input: item.input,
          output: item.output,
          subtaskId: item.subtaskId,
        })),
        generation: {
          ...this.draft.data.generation,
          mode: 'per-case-stdout',
          cases: this.draft.data.generation.cases.map(item => ({
            name: item.name,
            subtaskId: item.subtaskId,
            args: String(item.argsText || '').split(/\s+/).filter(Boolean),
            stdin: item.stdin || '',
            note: item.note || '',
          })),
        },
        generator: this.draft.data.generator,
      };
    },
    validateBeforeRun() {
      const data = this.dataPayload();
      const generationCases = data.generation.cases || [];
      const subtaskIds = new Set();
      let totalScore = 0;
      for (const item of data.subtasks || []) {
        const index = Number(item.index);
        const score = Number(item.score);
        if (!Number.isInteger(index) || index < 1 || subtaskIds.has(index)) {
          this.$message.error('子任务编号非法');
          return null;
        }
        if (!Number.isInteger(score) || score < 1 || score > 100) {
          this.$message.error(`子任务 #${index} 分数应为 1 到 100`);
          return null;
        }
        subtaskIds.add(index);
        totalScore += score;
      }
      if (!subtaskIds.size || totalScore !== 100) {
        this.$message.error(`子任务总分应为 100，当前为 ${totalScore}`);
        return null;
      }
      if (!generationCases.length && !data.cases.length) {
        this.$message.error('请至少保留一个生成点或静态 Case');
        return null;
      }
      for (const item of [...generationCases, ...data.cases]) {
        if (!subtaskIds.has(Number(item.subtaskId))) {
          this.$message.error(`测试点 ${item.name || ''} 绑定到不存在的子任务 #${item.subtaskId}`);
          return null;
        }
      }
      if (generationCases.length && !String(data.generator.source || '').trim()) {
        this.$message.error('请填写 Generator 源码');
        return null;
      }
      if (generationCases.length && !String(this.draft.std.source || '').trim()) {
        this.$message.error('请填写 STD 源码');
        return null;
      }
      return data;
    },
    async previewData() {
      const data = this.validateBeforeRun();
      if (!data) return;
      this.previewing = true;
      try {
        const res = await axios.post('/api/problem/ai/previewData', {
          pid: this.pid,
          data,
          std: this.draft.std,
        });
        if (res.status === 200 && res.data.data) {
          this.preview = res.data.data;
          this.$message.success('预览运行完成');
        } else {
          this.$message.error((res.data && res.data.message) || '预览失败');
        }
      } catch (err) {
        this.$message.error(this.apiError(err, '预览失败'));
      } finally {
        this.previewing = false;
      }
    },
    async saveData() {
      const data = this.validateBeforeRun();
      if (!data) return;
      try {
        await ElMessageBox.confirm(
          this.hasExistingData ? '确认覆盖当前测试数据？' : '确认写入测试数据？',
          '生成并写入',
          { confirmButtonText: '写入', cancelButtonText: '取消', type: 'warning' }
        );
      } catch (_) {
        return;
      }
      this.saving = true;
      try {
        const res = await axios.post('/api/problem/ai/saveData', {
          pid: this.pid,
          data,
          std: this.draft.std,
          confirmReplace: true,
        });
        if (res.status === 200) {
          const count = res.data && res.data.cases ? res.data.cases.length : 0;
          this.$message.success(count ? `已写入 ${count} 个测试点` : '测试数据已写入');
          this.$emit('saved', res.data || {});
        } else {
          this.$message.error((res.data && res.data.message) || '写入失败');
        }
      } catch (err) {
        this.$message.error(this.apiError(err, '写入失败'));
      } finally {
        this.saving = false;
      }
    },
    formatBytes(bytes) {
      const value = Number(bytes || 0);
      if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
      if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
      return `${value} B`;
    },
    apiError(err, fallback) {
      return (err.response && err.response.data && err.response.data.message) || err.message || fallback;
    },
  },
};
</script>

<style scoped>
.generator-panel {
  margin-bottom: 16px;
  padding: 14px;
  text-align: left;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  background: linear-gradient(180deg, #f8fbff 0%, #ffffff 180px);
}

.generator-head,
.head-actions,
.upload-row,
.panel-line,
.manual-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.generator-head {
  justify-content: space-between;
  margin-bottom: 8px;
}

.head-actions {
  justify-content: flex-end;
}

.eyebrow {
  color: #409eff;
  font-size: 12px;
  font-weight: 700;
}

h3 {
  margin: 0;
  color: #303133;
  font-size: 18px;
  line-height: 1.35;
}

.subline {
  margin-top: 2px;
  color: #606266;
  font-size: 13px;
}

.online-guide {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 12px 0;
}

.guide-step {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px;
  border: 1px solid #d9ecff;
  border-radius: 8px;
  background: rgba(255, 255, 255, .82);
}

.guide-index {
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

.guide-step strong {
  color: #303133;
  font-size: 13px;
}

.guide-step p {
  margin: 2px 0 0;
  color: #606266;
  font-size: 12px;
  line-height: 1.45;
}

.source-panel {
  margin-top: 10px;
}

.upload-row {
  margin-bottom: 0;
}

.json-input :deep(textarea),
.preview-panel pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

.editor-grid,
.plan-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.tool-panel,
.preview-panel {
  min-width: 0;
  padding: 10px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fff;
}

.panel-line {
  justify-content: space-between;
  margin-bottom: 8px;
}

.file-input {
  width: min(100%, 240px);
}

.gen-list,
.subtask-list,
.manual-list {
  display: grid;
  gap: 8px;
}

.gen-row,
.subtask-row {
  display: grid;
  grid-template-columns: minmax(100px, .5fr) 118px minmax(180px, 1fr) minmax(160px, .7fr) auto;
  gap: 8px;
  align-items: center;
}

.subtask-row {
  grid-template-columns: 46px 118px minmax(120px, .7fr) minmax(150px, 1fr) auto;
}

.case-name,
.case-args,
.case-note,
.option-select {
  width: 100%;
}

.subtask-index {
  font-weight: 700;
  color: #606266;
}

.manual-collapse {
  margin-top: 12px;
  border-top: 0;
  border-bottom: 0;
}

.collapse-title {
  font-weight: 700;
  color: #303133;
}

.manual-row {
  padding: 10px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fff;
}

.manual-head {
  margin-bottom: 8px;
}

.manual-cols {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.preview-panel {
  margin-top: 12px;
}

.preview-table {
  width: 100%;
}

.preview-meta {
  margin-bottom: 4px;
  color: #909399;
  font-size: 12px;
}

.preview-panel pre {
  box-sizing: border-box;
  max-height: 160px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #f8fafc;
  color: #303133;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.el-button {
  margin-left: 0;
}

@media (max-width: 980px) {
  .generator-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .head-actions {
    justify-content: flex-start;
  }

  .editor-grid,
  .plan-grid,
  .online-guide,
  .manual-cols,
  .gen-row,
  .subtask-row {
    grid-template-columns: 1fr;
  }
}
</style>
