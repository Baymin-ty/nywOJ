<template>
  <div class="homepage-settings">
    <header class="page-head">
      <div>
        <div class="eyebrow">ADMIN</div>
        <h1>首页设置</h1>
        <div class="page-subtitle">配置首页展示的模块、顺序与栏位</div>
      </div>
      <div class="head-actions">
        <el-button plain @click="addBlock">
          <el-icon class="el-icon--left"><Plus /></el-icon>
          添加模块
        </el-button>
        <el-button type="primary" :loading="saving" @click="saveHomeConfig">
          <el-icon class="el-icon--left"><Check /></el-icon>
          保存
        </el-button>
      </div>
    </header>

    <section class="panel" v-loading="loading">
      <div class="panel-title">
        <el-icon><Setting /></el-icon>
        首页模块
      </div>
      <el-empty v-if="!editingBlocks.length" description="暂无模块，点击右上角“添加模块”开始配置" />

      <div v-for="(block, index) in editingBlocks" :key="block.id" class="block-editor">
        <div class="block-editor-row">
          <el-switch v-model="block.enabled" active-text="显示" inactive-text="隐藏" />
          <el-select v-model="block.type" class="block-type">
            <el-option v-for="item in blockTypes" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <el-input v-model="block.title" class="block-title" maxlength="80" placeholder="模块标题" />
          <el-select v-model="block.column" class="block-column">
            <el-option label="主栏" value="main" />
            <el-option label="侧栏" value="side" />
          </el-select>
          <el-button :disabled="index === 0" circle @click="moveBlock(index, -1)">
            <el-icon><Top /></el-icon>
          </el-button>
          <el-button :disabled="index === editingBlocks.length - 1" circle @click="moveBlock(index, 1)">
            <el-icon><Bottom /></el-icon>
          </el-button>
          <el-button type="danger" circle @click="removeBlock(index)">
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
        <v-md-editor
          v-if="block.type === 'markdown'"
          v-model="block.content"
          height="180px"
          left-toolbar="undo redo clear | h bold italic strikethrough quote | ul ol table hr | link image code"
        />
      </div>
    </section>
  </div>
</template>

<script>
import axios from "axios";

export default {
  name: "homepageSettings",
  data() {
    return {
      loading: false,
      saving: false,
      editingBlocks: [],
      blockTypes: [
        { value: 'notice', label: '首页公告' },
        { value: 'announcements', label: '公告' },
        { value: 'hitokoto', label: '一言' },
        { value: 'problemSearch', label: '题目搜索' },
        { value: 'latestProblems', label: '最新题目' },
        { value: 'countdown', label: '倒计时' },
        { value: 'topUsers', label: '用户排行' },
        { value: 'friendLinks', label: '友情链接' },
        { value: 'rabbitRank', label: '点击排行' },
        { value: 'rabbitData', label: '点击统计' },
        { value: 'markdown', label: 'Markdown' },
      ],
    };
  },
  methods: {
    loadHomeConfig() {
      this.loading = true;
      return axios.post('/api/common/getHomeConfig').then(res => {
        if (res.status === 200) {
          const config = res.data.data || { blocks: [] };
          this.editingBlocks = JSON.parse(JSON.stringify(config.blocks || []));
        } else {
          this.$message.error(res.data.message || '获取首页设置失败');
        }
      }).catch(err => {
        this.$message.error('获取首页设置失败' + err.message);
      }).finally(() => {
        this.loading = false;
      });
    },
    addBlock() {
      this.editingBlocks.push({
        id: 'markdown-' + Date.now().toString(36),
        type: 'markdown',
        title: '自定义模块',
        column: 'main',
        enabled: true,
        content: '',
      });
    },
    moveBlock(index, step) {
      const target = index + step;
      if (target < 0 || target >= this.editingBlocks.length) return;
      const next = [...this.editingBlocks];
      const item = next.splice(index, 1)[0];
      next.splice(target, 0, item);
      this.editingBlocks = next;
    },
    removeBlock(index) {
      this.editingBlocks.splice(index, 1);
    },
    saveHomeConfig() {
      this.saving = true;
      axios.post('/api/common/updateHomeConfig', {
        config: { blocks: this.editingBlocks }
      }).then(res => {
        if (res.status === 200) {
          const config = res.data.data || { blocks: [] };
          this.editingBlocks = JSON.parse(JSON.stringify(config.blocks || []));
          this.$message.success('首页设置已保存');
        } else {
          this.$message.error(res.data.message || '保存首页设置失败');
        }
      }).catch(err => {
        this.$message.error('保存首页设置失败' + err.message);
      }).finally(() => {
        this.saving = false;
      });
    },
  },
  mounted() {
    this.loadHomeConfig();
  },
};
</script>

<style scoped>
.homepage-settings {
  max-width: 1100px;
  margin: 0 auto;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.eyebrow {
  color: #909399;
  font-size: 12px;
  font-weight: 700;
}

h1 {
  margin: 2px 0 0;
  color: #303133;
  font-size: 24px;
}

.page-subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}

.head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.panel {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 16px;
  background: #fff;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: #303133;
  font-weight: 700;
}

.block-editor {
  padding: 12px 0;
  border-top: 1px solid #ebeef5;
}

.panel-title + .block-editor,
.panel-title + .el-empty + .block-editor {
  border-top: none;
}

.block-editor-row {
  display: grid;
  grid-template-columns: 130px 150px minmax(180px, 1fr) 110px 36px 36px 36px;
  gap: 8px;
  align-items: center;
}

.block-type,
.block-column,
.block-title {
  width: 100%;
}

.block-editor :deep(.v-md-editor) {
  margin-top: 10px;
}

@media (max-width: 768px) {
  .page-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .head-actions {
    justify-content: flex-start;
  }

  .block-editor-row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
