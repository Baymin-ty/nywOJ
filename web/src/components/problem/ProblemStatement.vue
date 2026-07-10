<template>
  <div class="problem-statement">
    <template v-for="block in statementBlocks" :key="block.key">
      <v-md-preview v-if="block.type === 'markdown'" :text="block.text"> </v-md-preview>
      <div v-else-if="normalizedSamples.length" class="sample-section">
        <div v-for="(sample, index) in normalizedSamples" :key="index" class="sample-block">
          <div class="sample-title">样例 #{{ index + 1 }}</div>
          <div class="sample-grid">
            <div class="sample-pane">
              <div class="sample-pane-head">
                <span>输入</span>
                <el-button link size="small" @click="copySample(sample.inputData)">复制</el-button>
              </div>
              <pre class="sample-pre"><code>{{ sample.inputData }}</code></pre>
            </div>
            <div class="sample-pane" :class="{ 'is-empty': !sample.outputData }">
              <div class="sample-pane-head">
                <span>输出</span>
                <el-button link size="small" @click="copySample(sample.outputData)">复制</el-button>
              </div>
              <pre class="sample-pre"><code>{{ sample.outputData }}</code></pre>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
const MARKER_NAME = '(?:samples?|sample-list|cases?|case-list|样例)';
const RAW_SAMPLE_MARKER = `<!--\\s*${MARKER_NAME}\\s*-->`;
const ESCAPED_SAMPLE_MARKER = `(?:&lt;|&#60;|&#x3c;)!\\s*--\\s*${MARKER_NAME}\\s*--\\s*(?:&gt;|&#62;|&#x3e;)`;
const SAMPLE_MARKER_RE = new RegExp(`(?:${RAW_SAMPLE_MARKER}|${ESCAPED_SAMPLE_MARKER})`, 'i');
const SAMPLE_MARKER_SPLIT_RE = new RegExp(`(?:${RAW_SAMPLE_MARKER}|${ESCAPED_SAMPLE_MARKER})`, 'gi');

const buildStatementBlocks = (description) => {
  const text = String(description || '');
  if (!SAMPLE_MARKER_RE.test(text)) {
    const blocks = [];
    if (text.trim()) blocks.push({ type: 'markdown', text, key: 'markdown-default' });
    blocks.push({ type: 'samples', key: 'samples-default' });
    return blocks;
  }

  const blocks = [];
  const parts = text.split(SAMPLE_MARKER_SPLIT_RE);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].trim()) blocks.push({ type: 'markdown', text: parts[i], key: `markdown-${i}` });
    if (i < parts.length - 1) blocks.push({ type: 'samples', key: `samples-${i}` });
  }
  return blocks.length ? blocks : [{ type: 'samples', key: 'samples-only' }];
};

export default {
  name: 'ProblemStatement',
  props: {
    description: {
      type: String,
      default: '',
    },
    samples: {
      type: Array,
      default: () => [],
    },
  },
  computed: {
    normalizedSamples() {
      return Array.isArray(this.samples) ? this.samples : [];
    },
    statementBlocks() {
      return buildStatementBlocks(this.description);
    },
  },
  methods: {
    async copySample(text) {
      try {
        await navigator.clipboard.writeText(text || '');
        this.$message.success('已复制');
      } catch (_) {
        this.$message.error('复制失败');
      }
    },
  },
};
</script>

<style scoped>
.sample-section {
  padding: 0 20px 20px;
}

.sample-block {
  margin-top: 14px;
  border-top: 1px solid #ebeef5;
  padding-top: 12px;
}

.sample-title {
  margin-bottom: 8px;
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}

.sample-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.sample-pane {
  min-width: 0;
}

.sample-pane.is-empty {
  display: none;
}

.sample-pane-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 700;
  color: #606266;
}

.sample-pre {
  min-height: 44px;
  max-height: 260px;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #f7f8fa;
  color: #303133;
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre;
}

@media (max-width: 768px) {
  .sample-section {
    padding: 0 10px 14px;
  }

  .sample-grid {
    grid-template-columns: 1fr;
  }
}
</style>
