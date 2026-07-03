<template>
  <div class="judge-machine-page">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <div>
            <div class="page-title">评测机状态</div>
            <div class="page-subtitle">LibreOJ 兼容评测客户端</div>
          </div>
          <div class="header-actions">
            <el-button v-if="hasManagePermission" type="primary" plain @click="openAdd">
              <el-icon class="el-icon--left"><Plus /></el-icon>
              新增
            </el-button>
            <el-button type="primary" :loading="loading" @click="loadClients">
              <el-icon class="el-icon--left"><Refresh /></el-icon>
              刷新
            </el-button>
          </div>
        </div>
      </template>

      <el-empty v-if="!loading && !clients.length" description="暂无评测机" />
      <el-table v-else :data="clients" v-loading="loading" :header-cell-style="{ textAlign: 'center' }"
        :cell-style="{ textAlign: 'center' }">
        <el-table-column label="状态" width="110">
          <template #default="scope">
            <el-tag :type="scope.row.online ? 'success' : 'danger'" size="small">
              {{ scope.row.online ? '在线' : '离线' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名称" min-width="150" />
        <el-table-column label="CPU" min-width="220">
          <template #default="scope">{{ cpuText(scope.row) }}</template>
        </el-table-column>
        <el-table-column label="内存" min-width="180">
          <template #default="scope">{{ memoryText(scope.row) }}</template>
        </el-table-column>
        <el-table-column label="内核" min-width="180">
          <template #default="scope">{{ kernelText(scope.row) }}</template>
        </el-table-column>
        <el-table-column v-if="hasManagePermission" label="操作" width="210" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="showKey(scope.row)">Key</el-button>
            <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认重置此评测机 Key?"
              @confirm="resetKey(scope.row)">
              <template #reference>
                <el-button link type="warning">重置</el-button>
              </template>
            </el-popconfirm>
            <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认删除此评测机?"
              @confirm="deleteClient(scope.row)">
              <template #reference>
                <el-button link type="danger">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="addVisible" title="新增评测机" width="420px">
      <el-form label-width="72px">
        <el-form-item label="名称">
          <el-input v-model="newName" maxlength="80" @keyup.enter="addClient" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="addClient">新增</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="keyVisible" title="评测机 Key" width="560px">
      <el-alert type="warning" show-icon :closable="false" title="请妥善保存 Key；它用于官方 judge 客户端连接 /api/socket judge 命名空间。" />
      <el-input class="key-input" :model-value="activeKey" readonly />
      <template #footer>
        <el-button type="primary" @click="keyVisible = false">完成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import axios from 'axios';

export default {
  name: 'judgeMachine',
  data() {
    return {
      loading: false,
      saving: false,
      clients: [],
      hasManagePermission: false,
      addVisible: false,
      keyVisible: false,
      newName: '',
      activeKey: '',
    };
  },
  methods: {
    async loadClients() {
      this.loading = true;
      try {
        const res = await axios.get('/api/judgeClient/listJudgeClients');
        if (res.status === 200) {
          this.clients = res.data.judgeClients || [];
          this.hasManagePermission = !!res.data.hasManagePermission;
        } else {
          this.$message.error(res.data.message || '加载评测机失败');
        }
      } catch (err) {
        this.$message.error('加载评测机失败' + err.message);
      } finally {
        this.loading = false;
      }
    },
    openAdd() {
      this.newName = '';
      this.addVisible = true;
    },
    async addClient() {
      const name = this.newName.trim();
      if (!name) {
        this.$message.error('请输入评测机名称');
        return;
      }
      this.saving = true;
      try {
        const res = await axios.post('/api/judgeClient/addJudgeClient', { name, allowedHosts: [] });
        if (res.status === 200 && !res.data.error) {
          this.addVisible = false;
          this.activeKey = res.data.judgeClient?.key || '';
          if (this.activeKey) this.keyVisible = true;
          this.$message.success('评测机已新增');
          await this.loadClients();
        } else {
          this.$message.error(res.data.error || res.data.message || '新增评测机失败');
        }
      } catch (err) {
        this.$message.error('新增评测机失败' + err.message);
      } finally {
        this.saving = false;
      }
    },
    showKey(row) {
      this.activeKey = row.key || row.clientKey || row.maskedKey || '';
      this.keyVisible = true;
    },
    async resetKey(row) {
      try {
        const res = await axios.post('/api/judgeClient/resetJudgeClientKey', { id: row.id });
        if (res.status === 200 && !res.data.error) {
          this.activeKey = res.data.key || res.data.judgeClient?.key || '';
          this.keyVisible = true;
          this.$message.success('Key 已重置');
          await this.loadClients();
        } else {
          this.$message.error(res.data.error || res.data.message || '重置 Key 失败');
        }
      } catch (err) {
        this.$message.error('重置 Key 失败' + err.message);
      }
    },
    async deleteClient(row) {
      try {
        const res = await axios.post('/api/judgeClient/deleteJudgeClient', { id: row.id });
        if (res.status === 200 && !res.data.error) {
          this.$message.success('评测机已删除');
          await this.loadClients();
        } else {
          this.$message.error(res.data.error || res.data.message || '删除评测机失败');
        }
      } catch (err) {
        this.$message.error('删除评测机失败' + err.message);
      }
    },
    cpuText(row) {
      return row.systemInfo?.cpu?.model || '-';
    },
    memoryText(row) {
      const memory = row.systemInfo?.memory;
      if (!memory) return '-';
      if (memory.description) return memory.description;
      return memory.size ? `${Math.round(Number(memory.size) / 1024)} MiB` : '-';
    },
    kernelText(row) {
      return row.systemInfo?.kernel || '-';
    },
  },
  mounted() {
    this.loadClients();
  },
};
</script>

<style scoped>
.judge-machine-page {
  margin: 0 auto;
  max-width: 1200px;
}

.box-card {
  margin: 10px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.page-title {
  color: #303133;
  font-size: 20px;
  font-weight: 800;
}

.page-subtitle {
  margin-top: 2px;
  color: #909399;
  font-size: 12px;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.header-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.key-input {
  margin-top: 12px;
}

@media (max-width: 768px) {
  .card-header {
    align-items: stretch;
    flex-direction: column;
  }

  .header-actions {
    justify-content: flex-start;
  }
}
</style>
