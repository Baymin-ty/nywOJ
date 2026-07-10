<template>
  <div class="migration-page">
    <header class="page-head">
      <div>
        <div class="eyebrow">ADMIN</div>
        <h1>迁移工具</h1>
      </div>
      <el-button plain icon="Refresh" :loading="checking" @click="runDryRun" :disabled="!payload">
        重新预检
      </el-button>
    </header>

    <div class="migration-grid">
      <section class="panel">
        <div class="panel-title">
          <el-icon><Download /></el-icon>
          导出 JSON
        </div>
        <el-checkbox-group v-model="exportGroups" class="group-list">
          <el-checkbox label="users">用户</el-checkbox>
          <el-checkbox label="problems">题目元数据</el-checkbox>
          <el-checkbox label="submissions">提交记录</el-checkbox>
          <el-checkbox label="discussions">讨论区</el-checkbox>
        </el-checkbox-group>
        <el-button type="primary" icon="Download" :loading="exporting" @click="exportData">
          导出
        </el-button>
      </section>

      <section class="panel">
        <div class="panel-title">
          <el-icon><UploadFilled /></el-icon>
          导入 JSON
        </div>
        <el-upload
          drag
          action=""
          :auto-upload="false"
          :limit="1"
          accept=".json,application/json"
          :on-change="onFilePicked"
          :on-remove="clearImport"
        >
          <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
          <div class="el-upload__text">拖入迁移 JSON 或点击选择</div>
        </el-upload>
        <div class="import-actions">
          <el-button plain icon="Search" :loading="checking" :disabled="!payload" @click="runDryRun">
            预检
          </el-button>
          <el-button type="danger" icon="Upload" :loading="importing" :disabled="!payload || !summary.length" @click="applyImport">
            执行导入
          </el-button>
        </div>
      </section>
    </div>

    <section class="panel summary-panel">
      <div class="panel-title">
        <el-icon><Tickets /></el-icon>
        预检结果
      </div>
      <el-table :data="summary" v-loading="checking || importing" empty-text="选择文件后先预检">
        <el-table-column prop="table" label="表" width="190" />
        <el-table-column prop="rows" label="行数" width="100" />
        <el-table-column label="状态" width="120">
          <template #default="scope">
            <el-tag :type="scope.row.exists ? 'success' : 'danger'" size="small">
              {{ scope.row.exists ? '可导入' : '表不存在' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="列">
          <template #default="scope">
            <span class="muted">{{ (scope.row.columns || []).join(', ') || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="忽略列">
          <template #default="scope">
            <span class="muted">{{ (scope.row.ignoredColumns || []).join(', ') || '—' }}</span>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<script>
import axios from 'axios';
import { ElMessageBox } from 'element-plus';

export default {
  name: 'migrationTool',
  data() {
    return {
      exportGroups: ['users', 'problems', 'submissions', 'discussions'],
      exporting: false,
      checking: false,
      importing: false,
      payload: null,
      summary: [],
    };
  },
  methods: {
    async exportData() {
      if (!this.exportGroups.length) {
        this.$message.error('请选择导出范围');
        return;
      }
      this.exporting = true;
      try {
        const res = await axios.post('/api/admin/exportMigration', { include: this.exportGroups });
        if (res.status !== 200) {
          this.$message.error(res.data.message || '导出失败');
          return;
        }
        const blob = new Blob([JSON.stringify(res.data.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nywoj-migration-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.$message.success('导出完成');
      } catch (err) {
        this.$message.error('导出失败');
      } finally {
        this.exporting = false;
      }
    },
    onFilePicked(file) {
      const raw = file.raw;
      if (!raw) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          this.payload = JSON.parse(reader.result);
          this.runDryRun();
        } catch (_) {
          this.payload = null;
          this.summary = [];
          this.$message.error('JSON 格式无效');
        }
      };
      reader.readAsText(raw);
    },
    clearImport() {
      this.payload = null;
      this.summary = [];
    },
    async runDryRun() {
      if (!this.payload) return;
      this.checking = true;
      try {
        const res = await axios.post('/api/admin/importMigration', { payload: this.payload, dryRun: true });
        if (res.status === 200) {
          this.summary = res.data.summary || [];
        } else {
          this.$message.error(res.data.message || '预检失败');
        }
      } catch (err) {
        this.$message.error('预检失败');
      } finally {
        this.checking = false;
      }
    },
    async applyImport() {
      if (!this.payload) return;
      try {
        await ElMessageBox.confirm('导入将按主键 upsert 迁移文件中的数据，确认继续？', '确认导入', { type: 'warning' });
      } catch (_) {
        return;
      }
      this.importing = true;
      try {
        const res = await axios.post('/api/admin/importMigration', { payload: this.payload, dryRun: false });
        if (res.status === 200) {
          this.summary = res.data.summary || [];
          this.$message.success('导入完成');
        } else {
          this.$message.error(res.data.message || '导入失败');
        }
      } catch (err) {
        this.$message.error('导入失败');
      } finally {
        this.importing = false;
      }
    },
  },
};
</script>

<style scoped>
.migration-page {
  max-width: 1180px;
  margin: 18px auto;
  padding: 0 14px 30px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.eyebrow {
  color: #909399;
  font-size: 12px;
  font-weight: 700;
}

h1 {
  margin: 2px 0 0;
  font-size: 24px;
  color: #303133;
}

.migration-grid {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 14px;
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
  margin-bottom: 14px;
  font-weight: 700;
  color: #303133;
}

.group-list {
  display: grid;
  gap: 8px;
  margin-bottom: 16px;
}

.import-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
}

.summary-panel {
  margin-top: 14px;
}

.muted {
  color: #606266;
  font-size: 12px;
}

@media (max-width: 860px) {
  .migration-grid {
    grid-template-columns: 1fr;
  }
}
</style>
