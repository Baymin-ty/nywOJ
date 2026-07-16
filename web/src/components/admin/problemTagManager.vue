<template>
  <div class="tag-page">
    <header class="page-head">
      <div>
        <div class="eyebrow">ADMIN</div>
        <h1>题目标签</h1>
      </div>
      <div class="head-actions">
        <el-button plain icon="Refresh" :loading="loading" @click="fetchTags">刷新</el-button>
        <el-button type="primary" icon="Plus" @click="openCreate()">新建标签</el-button>
      </div>
    </header>

    <section class="panel">
      <div class="panel-title">
        <el-icon><Operation /></el-icon>
        标签目录
      </div>
      <el-table :data="tags" v-loading="loading" empty-text="暂无目录标签">
        <el-table-column label="名称" min-width="210">
          <template #default="scope">
            <div class="name-cell">
              <span class="swatch" :style="{ backgroundColor: scope.row.color }"></span>
              <span>{{ primaryName(scope.row) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="多语言名" min-width="260">
          <template #default="scope">
            <div class="locale-list">
              <el-tag v-for="item in scope.row.localizedNames" :key="item.locale" size="small" effect="plain">
                {{ item.locale }}: {{ item.name }}
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="usage" label="使用" width="90" />
        <el-table-column prop="updateTime" label="更新" width="180" />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="scope">
            <el-button-group>
              <el-button plain icon="Edit" @click="openEdit(scope.row)" />
              <el-button plain type="danger" icon="Delete" @click="deleteTag(scope.row)" />
            </el-button-group>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel">
      <div class="panel-title">
        <el-icon><Grid /></el-icon>
        现有标签
      </div>
      <el-table :data="uncataloguedTags" v-loading="loading" empty-text="所有已使用标签都在目录中">
        <el-table-column prop="name" label="名称" min-width="220" />
        <el-table-column prop="usage" label="使用" width="90" />
        <el-table-column label="操作" width="120">
          <template #default="scope">
            <el-button plain size="small" icon="Plus" @click="openCreate(scope.row.name)">收录</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑标签' : '新建标签'" width="min(620px, 92vw)">
      <el-form label-width="88px" class="tag-form">
        <el-form-item label="颜色">
          <el-color-picker v-model="form.color" />
          <span class="color-text">{{ form.color }}</span>
        </el-form-item>
        <el-form-item label="名称">
          <div class="locale-editor">
            <div class="locale-row" v-for="(item, index) in form.localizedNames" :key="index">
              <el-select v-model="item.locale" filterable>
                <el-option v-for="locale in localeOptions" :key="locale.value" :value="locale.value" :label="locale.label" />
              </el-select>
              <el-input v-model="item.name" maxlength="30" show-word-limit />
              <el-button plain icon="Close" :disabled="form.localizedNames.length <= 1" @click="removeLocale(index)" />
            </div>
            <el-button plain icon="Plus" @click="addLocale">添加语言</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button icon="Close" @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" icon="Check" :loading="saving" @click="saveTag">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import axios from 'axios';
import { ElMessageBox } from 'element-plus';

const emptyForm = (name = '') => ({
  color: '#409eff',
  localizedNames: [{ locale: 'zh-CN', name }],
});

export default {
  name: 'problemTagManager',
  data() {
    return {
      loading: false,
      saving: false,
      tags: [],
      uncataloguedTags: [],
      dialogVisible: false,
      editingId: 0,
      form: emptyForm(),
      localeOptions: [
        { value: 'zh-CN', label: '简体中文' },
        { value: 'en', label: 'English' },
        { value: 'ja', label: '日本語' },
      ],
    };
  },
  methods: {
    apiOk(res) {
      return res.status === 200 && !(res.data && res.data.error);
    },
    apiMessage(res, fallback) {
      return (res.data && (res.data.message || res.data.error)) || fallback;
    },
    async fetchTags() {
      this.loading = true;
      try {
        const res = await axios.post('/api/problem/getAllProblemTagsOfAllLocales');
        if (this.apiOk(res)) {
          this.tags = res.data.tags || [];
          this.uncataloguedTags = res.data.uncataloguedTags || [];
        } else {
          this.$message.error(this.apiMessage(res, '加载失败'));
        }
      } catch (err) {
        this.$message.error('加载失败');
      } finally {
        this.loading = false;
      }
    },
    primaryName(row) {
      const list = row.localizedNames || [];
      return (list.find((item) => item.locale === 'zh-CN') || list[0] || {}).name || `#${row.id}`;
    },
    openCreate(name = '') {
      this.editingId = 0;
      this.form = emptyForm(name);
      this.dialogVisible = true;
    },
    openEdit(row) {
      this.editingId = row.id;
      this.form = {
        color: row.color || '#409eff',
        localizedNames: (row.localizedNames || []).map((item) => ({ ...item })),
      };
      if (!this.form.localizedNames.length) this.form.localizedNames.push({ locale: 'zh-CN', name: '' });
      this.dialogVisible = true;
    },
    addLocale() {
      const used = new Set(this.form.localizedNames.map((item) => item.locale));
      const next = this.localeOptions.find((item) => !used.has(item.value));
      this.form.localizedNames.push({ locale: next ? next.value : 'en', name: '' });
    },
    removeLocale(index) {
      this.form.localizedNames.splice(index, 1);
    },
    normalizedPayload() {
      const color = this.form.color;
      const localizedNames = this.form.localizedNames
        .map((item) => ({ locale: item.locale, name: String(item.name || '').trim() }))
        .filter((item) => item.name);
      if (!localizedNames.length) {
        this.$message.error('请填写标签名');
        return null;
      }
      return { id: this.editingId, color, localizedNames };
    },
    async saveTag() {
      const payload = this.normalizedPayload();
      if (!payload) return;
      this.saving = true;
      try {
        const api = this.editingId ? '/api/problem/updateProblemTag' : '/api/problem/createProblemTag';
        const res = await axios.post(api, payload);
        if (this.apiOk(res)) {
          this.$message.success('已保存');
          this.dialogVisible = false;
          await this.fetchTags();
        } else {
          this.$message.error(this.apiMessage(res, '保存失败'));
        }
      } catch (err) {
        this.$message.error('保存失败');
      } finally {
        this.saving = false;
      }
    },
    async deleteTag(row) {
      try {
        await ElMessageBox.confirm(`删除标签“${this.primaryName(row)}”？`, '确认删除', { type: 'warning' });
      } catch (_) {
        return;
      }
      try {
        const res = await axios.post('/api/problem/deleteProblemTag', { id: row.id });
        if (this.apiOk(res)) {
          this.$message.success('已删除');
          await this.fetchTags();
        } else {
          this.$message.error(this.apiMessage(res, '删除失败'));
        }
      } catch (err) {
        this.$message.error('删除失败');
      }
    },
  },
  mounted() {
    this.fetchTags();
  },
};
</script>

<style scoped>
.tag-page {
  max-width: 1180px;
  margin: 18px auto;
  padding: 0 14px 30px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.eyebrow {
  color: #909399;
  font-size: 12px;
  font-weight: 700;
}

h1 {
  margin: 2px 0 0;
  font-size: 26px;
}

.panel {
  margin-bottom: 14px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 13px 16px;
  border-bottom: 1px solid #ebeef5;
  color: #303133;
  font-weight: 700;
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.swatch {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, .12);
  flex: 0 0 auto;
}

.locale-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tag-form {
  padding-top: 6px;
}

.color-text {
  margin-left: 10px;
  color: #606266;
}

.locale-editor {
  display: grid;
  gap: 10px;
  width: 100%;
}

.locale-row {
  display: grid;
  grid-template-columns: 128px minmax(0, 1fr) 38px;
  gap: 8px;
  align-items: center;
}

@media (max-width: 700px) {
  .page-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .head-actions {
    justify-content: flex-start;
  }

  .locale-row {
    grid-template-columns: 1fr;
  }

  .tag-page {
    padding-inline: 0;
  }

  .tag-form :deep(.el-form-item) {
    display: block;
  }

  .tag-form :deep(.el-form-item__label),
  .tag-form :deep(.el-form-item__content) {
    width: 100% !important;
    margin-left: 0 !important;
  }
}
</style>
