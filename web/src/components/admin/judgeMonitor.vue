<template>
  <div class="monitor-page">
    <header class="page-head">
      <div>
        <div class="eyebrow">ADMIN</div>
        <h1>评测监控</h1>
        <div class="page-subtitle">刷新时间：{{ monitor.refreshedAt || '-' }}</div>
      </div>
      <div class="head-actions">
        <el-button v-if="$can('judge.client.manage')" type="primary" plain @click="openCreateClient">
          <el-icon class="el-icon--left"><Plus /></el-icon>
          新增评测机
        </el-button>
        <el-button type="primary" :loading="loading" @click="all">
          <el-icon class="el-icon--left"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </header>

    <div class="metric-grid">
      <div class="metric">
        <div class="metric-label">队列等待</div>
        <div class="metric-value">{{ monitor.queue?.waiting ?? 0 }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">正在评测</div>
        <div class="metric-value">{{ monitor.queue?.running ?? 0 }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">并发上限</div>
        <div class="metric-value">{{ monitor.queue?.concurrency ?? 0 }}</div>
      </div>
      <div class="metric" :class="monitor.sandbox?.ok ? 'metric-ok' : 'metric-bad'">
        <div class="metric-label">Sandbox</div>
        <div class="metric-value">{{ monitor.sandbox?.ok ? '正常' : '异常' }}</div>
        <div class="metric-note">{{ monitor.sandbox?.latency ?? '-' }} ms</div>
      </div>
    </div>

    <el-alert
      v-if="monitor.sandbox && !monitor.sandbox.ok"
      type="error"
      show-icon
      :closable="false"
      :title="`评测沙箱不可用：${monitor.sandbox.message || monitor.sandbox.status}`"
      class="monitor-alert" />

    <div class="section-grid">
      <section class="panel">
        <div class="panel-title">提交吞吐</div>
        <div class="throughput">
          <div>
            <span>{{ monitor.throughput?.lastHour || 0 }}</span>
            <label>最近 1 小时</label>
          </div>
          <div>
            <span>{{ monitor.throughput?.today || 0 }}</span>
            <label>今日</label>
          </div>
          <div>
            <span>{{ monitor.throughput?.total || 0 }}</span>
            <label>累计</label>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">关键状态</div>
        <el-table :data="monitor.statuses || []" height="220" :cell-style="statusCellStyle"
          :header-cell-style="{ textAlign: 'center' }">
          <el-table-column prop="result" label="状态" />
          <el-table-column prop="cnt" label="数量" width="100" />
        </el-table>
      </section>
    </div>

    <section class="panel clients-card">
      <div class="client-title-row panel-title">
        <span>注册评测机</span>
        <span class="client-note">队列显示为 运行 / 等待 / 并发</span>
      </div>
      <el-table :data="monitor.clients || []" height="280" :header-cell-style="{ textAlign: 'center' }"
        :cell-style="{ textAlign: 'center' }">
        <el-table-column prop="name" label="名称" min-width="130" />
        <el-table-column prop="endpoint" label="地址" min-width="220">
          <template #default="scope">
            <span>{{ scope.row.endpoint || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="enabled" label="状态" width="90">
          <template #default="scope">
            <el-tag :type="scope.row.enabled ? 'success' : 'info'" size="small">
              {{ scope.row.enabled ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="lastStatus" label="最近状态" width="110">
          <template #default="scope">
            <el-tag :type="statusTagType(scope.row.lastStatus)" size="small">
              {{ scope.row.lastStatus || 'new' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="队列" width="120">
          <template #default="scope">
            {{ scope.row.queueRunning || 0 }} / {{ scope.row.queueWaiting || 0 }} / {{ scope.row.queueConcurrency || 0 }}
          </template>
        </el-table-column>
        <el-table-column prop="lastSeenAt" label="最近联系" min-width="150">
          <template #default="scope">
            <span>{{ scope.row.lastSeenAt || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="lastTaskSid" label="最近任务" width="100">
          <template #default="scope">
            <router-link v-if="scope.row.lastTaskSid" class="rlink" :to="'/submission/' + scope.row.lastTaskSid">
              {{ scope.row.lastTaskSid }}
            </router-link>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column v-if="$can('judge.client.manage')" label="操作" width="260" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="openEditClient(scope.row)">编辑</el-button>
            <el-button link :type="scope.row.enabled ? 'warning' : 'success'" @click="toggleClient(scope.row)">
              {{ scope.row.enabled ? '禁用' : '启用' }}
            </el-button>
            <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认重置此评测机 Key?" @confirm="resetClientKey(scope.row)">
              <template #reference>
                <el-button link type="warning">重置 Key</el-button>
              </template>
            </el-popconfirm>
            <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认删除此评测机?" @confirm="deleteClient(scope.row)">
              <template #reference>
                <el-button link type="danger">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <div class="section-grid">
      <section class="panel">
        <div class="panel-title">评测机近 24 小时</div>
        <el-table :data="monitor.machines || []" height="260" :header-cell-style="{ textAlign: 'center' }"
          :cell-style="{ textAlign: 'center' }">
          <el-table-column prop="machine" label="评测机" />
          <el-table-column prop="cnt" label="提交" width="90" />
          <el-table-column prop="lastSubmit" label="最后提交" min-width="150" />
        </el-table>
      </section>

      <section class="panel">
        <div class="panel-title">最近异常</div>
        <el-table :data="monitor.recentFailures || []" height="260" :header-cell-style="{ textAlign: 'center' }"
          :cell-style="failureCellStyle">
          <el-table-column prop="sid" label="#" width="80">
            <template #default="scope">
              <router-link class="rlink" :to="'/submission/' + scope.row.sid">{{ scope.row.sid }}</router-link>
            </template>
          </el-table-column>
          <el-table-column prop="title" label="题目" min-width="160">
            <template #default="scope">
              <router-link class="rlink" :to="'/problem/' + scope.row.pid">{{ scope.row.title }}</router-link>
            </template>
          </el-table-column>
          <el-table-column prop="judgeResult" label="结果" min-width="150" />
          <el-table-column prop="submitTime" label="时间" min-width="160" />
        </el-table>
      </section>
    </div>

    <el-dialog v-model="clientDialogVisible" :title="clientDialogMode === 'create' ? '新增评测机' : '编辑评测机'" width="520px">
      <el-form label-width="90px">
        <el-form-item label="名称">
          <el-input v-model="clientForm.name" maxlength="80" />
        </el-form-item>
        <el-form-item label="接收地址">
          <el-input v-model="clientForm.endpoint" placeholder="http://host:1234/api/judge/receiveTask" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="clientDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="clientSaving" @click="saveClient">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="clientKeyVisible" title="评测机 Key" width="560px">
      <el-alert type="warning" show-icon :closable="false" title="关闭窗口后不再展示完整 Key；请将它写入客户端 JUDGE.CLIENT_KEY。" />
      <el-input class="client-key-input" :model-value="clientKey" readonly />
      <template #footer>
        <el-button type="primary" @click="clientKeyVisible = false">完成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import axios from 'axios';
import { resColor } from '@/assets/common';

export default {
  name: 'judgeMonitor',
  data() {
    return {
      loading: false,
      monitor: {
        queue: {},
        sandbox: null,
        statuses: [],
        recentFailures: [],
        machines: [],
        clients: [],
        throughput: {},
        refreshedAt: '',
      },
      timer: null,
      lastFetch: 0,
      clientDialogVisible: false,
      clientDialogMode: 'create',
      clientSaving: false,
      clientForm: {
        id: 0,
        name: '',
        endpoint: '',
      },
      clientKeyVisible: false,
      clientKey: '',
    };
  },
  methods: {
    all() {
      this.lastFetch = Date.now();
      this.loading = true;
      axios.post('/api/admin/getJudgeMonitor').then(res => {
        if (res.status === 200) {
          this.monitor = res.data.data || this.monitor;
        } else {
          this.$message.error(res.data.message || '获取评测监控失败');
        }
      }).catch(err => {
        this.$message.error('获取评测监控失败' + err.message);
      }).finally(() => {
        this.loading = false;
      });
    },
    statusCellStyle({ row, columnIndex }) {
      const style = { textAlign: 'center' };
      if (columnIndex === 0) {
        style.fontWeight = 600;
        style.color = resColor[row.result] || '#606266';
      }
      return style;
    },
    failureCellStyle({ row, columnIndex }) {
      const style = { textAlign: 'center' };
      if (columnIndex === 2) {
        style.fontWeight = 600;
        style.color = resColor[row.judgeResult] || '#606266';
      }
      return style;
    },
    statusTagType(status) {
      if (status === 'ok' || status === 'online') return 'success';
      if (status === 'error') return 'danger';
      if (status === 'disabled') return 'info';
      return 'warning';
    },
    openCreateClient() {
      this.clientDialogMode = 'create';
      this.clientForm = { id: 0, name: '', endpoint: '' };
      this.clientDialogVisible = true;
    },
    openEditClient(row) {
      this.clientDialogMode = 'edit';
      this.clientForm = { id: row.id, name: row.name, endpoint: row.endpoint || '' };
      this.clientDialogVisible = true;
    },
    saveClient() {
      if (!this.clientForm.name.trim()) {
        this.$message.error('请输入评测机名称');
        return;
      }
      this.clientSaving = true;
      const request = this.clientDialogMode === 'create'
        ? axios.post('/api/admin/createJudgeClient', {
          name: this.clientForm.name,
          endpoint: this.clientForm.endpoint,
        })
        : axios.post('/api/admin/updateJudgeClient', {
          id: this.clientForm.id,
          name: this.clientForm.name,
          endpoint: this.clientForm.endpoint,
        });
      request.then(res => {
        if (res.status === 200) {
          this.clientDialogVisible = false;
          this.$message.success('已保存评测机');
          if (res.data.clientKey) {
            this.clientKey = res.data.clientKey;
            this.clientKeyVisible = true;
          }
          this.all();
        } else {
          this.$message.error(res.data.message || '保存评测机失败');
        }
      }).catch(err => {
        this.$message.error('保存评测机失败' + err.message);
      }).finally(() => {
        this.clientSaving = false;
      });
    },
    toggleClient(row) {
      axios.post('/api/admin/updateJudgeClient', { id: row.id, enabled: !row.enabled }).then(res => {
        if (res.status === 200) {
          this.$message.success(row.enabled ? '已禁用评测机' : '已启用评测机');
          this.all();
        } else {
          this.$message.error(res.data.message || '更新评测机失败');
        }
      });
    },
    resetClientKey(row) {
      axios.post('/api/admin/resetJudgeClientKey', { id: row.id }).then(res => {
        if (res.status === 200) {
          this.clientKey = res.data.clientKey;
          this.clientKeyVisible = true;
          this.$message.success('Key 已重置');
          this.all();
        } else {
          this.$message.error(res.data.message || '重置 Key 失败');
        }
      });
    },
    deleteClient(row) {
      axios.post('/api/admin/deleteJudgeClient', { id: row.id }).then(res => {
        if (res.status === 200) {
          this.$message.success('已删除评测机');
          this.all();
        } else {
          this.$message.error(res.data.message || '删除评测机失败');
        }
      });
    },
    // 标签页不可见时跳过轮询，避免后台标签持续请求（并触发沙箱探针）。
    onVisibilityChange() {
      if (!document.hidden && Date.now() - this.lastFetch > 10000) this.all();
    },
  },
  mounted() {
    this.all();
    this.timer = setInterval(() => {
      if (!document.hidden) this.all();
    }, 30000);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  },
  beforeUnmount() {
    if (this.timer) clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  },
};
</script>

<style scoped>
.monitor-page {
  margin: 0 auto;
  max-width: 1250px;
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
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.head-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.metric {
  min-height: 92px;
  padding: 14px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #f8fafc;
}

.metric-label {
  font-size: 13px;
  color: #909399;
}

.metric-value {
  margin-top: 8px;
  font-size: 28px;
  font-weight: 800;
  color: #303133;
}

.metric-note {
  margin-top: 2px;
  font-size: 12px;
  color: #909399;
}

.metric-ok {
  background: #f0f9eb;
  border-color: #d9f0cf;
}

.metric-bad {
  background: #fef0f0;
  border-color: #fbc4c4;
}

.monitor-alert {
  margin-top: 12px;
}

.panel {
  padding: 16px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
}

.panel-title {
  margin-bottom: 12px;
  color: #303133;
  font-weight: 800;
}

.section-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.clients-card {
  margin-top: 10px;
}

.client-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.client-note {
  font-size: 12px;
  color: #909399;
}

.client-key-input {
  margin-top: 12px;
}

.throughput {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.throughput div {
  min-height: 130px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  border-radius: 6px;
  background: #f5f7fa;
}

.throughput span {
  font-size: 30px;
  font-weight: 800;
  color: #303133;
}

.throughput label {
  margin-top: 8px;
  font-size: 13px;
  color: #909399;
}

@media (max-width: 768px) {
  .monitor-page {
    width: 100%;
  }

  .page-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .metric-grid,
  .section-grid {
    grid-template-columns: 1fr;
  }

  .throughput {
    grid-template-columns: 1fr;
  }

  .throughput div {
    min-height: 86px;
  }
}
</style>
