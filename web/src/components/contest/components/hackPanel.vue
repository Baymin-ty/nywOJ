<template>
  <div class="hack-panel">
    <el-alert v-if="!canHack" type="info" show-icon :closable="false"
      title="Hack 资格：比赛进行中，且你已通过该题的 pretest。" />
    <div class="hack-stats">
      <el-tag type="success">成功 {{ stats.success }}</el-tag>
      <el-tag type="danger">失败 {{ stats.failed }}</el-tag>
      <el-tag type="warning" v-if="stats.running">判定中 {{ stats.running }}</el-tag>
      <el-button size="small" circle plain @click="all">
        <el-icon><Refresh /></el-icon>
      </el-button>
    </div>

    <el-tabs v-model="activeTab">
      <el-tab-pane label="可 Hack 目标" name="targets" :disabled="!canHack">
        <el-alert v-if="lockedIdx.length" class="hack-tip" type="success" :closable="false"
          :title="`你已解锁题目：${lockedIdx.join('、')}（通过 pretest 即可 hack 他人该题提交）`" />
        <el-table :data="targets" v-loading="targetsLoading" empty-text="暂无可 hack 的提交">
          <el-table-column prop="idx" label="题目" width="80">
            <template #default="scope">
              <router-link class="rlink" :to="'/contest/' + cid + '/problem/' + scope.row.idx">
                {{ scope.row.idx }}
              </router-link>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="选手" min-width="140" />
          <el-table-column prop="submitTime" label="通过时间" min-width="160" />
          <el-table-column label="操作" width="200">
            <template #default="scope">
              <el-button size="small" @click="viewCode(scope.row)">查看代码</el-button>
              <el-button size="small" type="danger" plain @click="openHack(scope.row)">Hack</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
      <el-tab-pane :label="fullView ? '全部 Hack 记录' : '我的 Hack'" name="records">
        <el-table :data="records" v-loading="recordsLoading" empty-text="暂无记录">
          <el-table-column prop="hackId" label="#" width="70" />
          <el-table-column prop="idx" label="题目" width="70" />
          <el-table-column prop="hackerName" label="发起者" min-width="120" v-if="fullView" />
          <el-table-column prop="targetName" label="目标" min-width="120" />
          <el-table-column label="状态" width="110">
            <template #default="scope">
              <el-tag :type="statusType(scope.row.status)" effect="dark">
                {{ statusLabel(scope.row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="verdict" label="详情" min-width="220" show-overflow-tooltip />
          <el-table-column prop="createTime" label="发起时间" min-width="150" />
        </el-table>
        <el-pagination v-if="recordsTotal > 20" class="hack-pagination" layout="prev, pager, next, total"
          :total="recordsTotal" v-model:current-page="recordsPage" :page-size="20" @current-change="loadRecords" />
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="codeVisible" :title="`${codeTarget.name} 的提交 #${codeTarget.sid}`" width="min(900px, 92vw)">
      <pre class="hack-code">{{ codeTarget.code }}</pre>
      <template #footer>
        <el-button type="danger" @click="openHack(codeTarget)">Hack 这份提交</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="hackVisible" :title="`Hack ${hackTarget.name} 的提交 #${hackTarget.sid}`" width="min(720px, 92vw)">
      <el-alert class="hack-tip" type="warning" :closable="false"
        title="提交一组输入数据。数据先经题目 validator 校验，再用标程生成期望输出并运行目标代码比对。成功 +100，失败 −50。" />
      <el-input v-model="hackInput" type="textarea" :rows="12" placeholder="输入数据（≤256KB）" />
      <template #footer>
        <el-button @click="hackVisible = false">取消</el-button>
        <el-button type="danger" :loading="hackSubmitting" @click="doHack">提交 Hack</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import axios from 'axios';

export default {
  name: 'hackPanel',
  props: {
    canHack: { type: Boolean, default: false },
  },
  data() {
    return {
      cid: 0,
      activeTab: 'targets',
      targets: [],
      lockedIdx: [],
      targetsLoading: false,
      records: [],
      recordsTotal: 0,
      recordsPage: 1,
      recordsLoading: false,
      stats: { success: 0, failed: 0, running: 0 },
      fullView: false,
      codeVisible: false,
      codeTarget: {},
      hackVisible: false,
      hackTarget: {},
      hackInput: '',
      hackSubmitting: false,
      pollTimer: null,
    };
  },
  methods: {
    all() {
      if (this.canHack) this.loadTargets();
      else this.activeTab = 'records';
      this.loadRecords();
    },
    loadTargets() {
      this.targetsLoading = true;
      axios.post('/api/contest/getHackTargets', { cid: this.cid }).then(res => {
        this.targets = res.data.data || [];
        this.lockedIdx = res.data.lockedIdx || [];
      }).catch(() => { }).finally(() => { this.targetsLoading = false; });
    },
    loadRecords() {
      this.recordsLoading = true;
      axios.post('/api/contest/getHackList', {
        cid: this.cid, pageId: this.recordsPage, pageSize: 20,
      }).then(res => {
        this.records = res.data.data || [];
        this.recordsTotal = res.data.total || 0;
        this.stats = res.data.stats || this.stats;
        this.fullView = !!res.data.fullView;
        // 有判定中的记录时轮询刷新
        clearTimeout(this.pollTimer);
        if (this.stats.running > 0) {
          this.pollTimer = setTimeout(() => this.loadRecords(), 3000);
        }
      }).catch(() => { }).finally(() => { this.recordsLoading = false; });
    },
    viewCode(row) {
      axios.post('/api/contest/getHackTargetCode', { cid: this.cid, sid: row.sid }).then(res => {
        this.codeTarget = res.data.data;
        this.codeVisible = true;
      }).catch(err => {
        this.$message.error(this.apiError(err, '查看失败'));
      });
    },
    openHack(row) {
      this.hackTarget = row;
      this.hackInput = '';
      this.codeVisible = false;
      this.hackVisible = true;
    },
    doHack() {
      if (!this.hackInput.trim()) {
        this.$message.error('请填写输入数据');
        return;
      }
      this.hackSubmitting = true;
      axios.post('/api/contest/submitHack', {
        cid: this.cid, targetSid: this.hackTarget.sid, input: this.hackInput,
      }).then(() => {
        this.$message.success('Hack 已提交，正在判定');
        this.hackVisible = false;
        this.activeTab = 'records';
        this.loadRecords();
      }).catch(err => {
        this.$message.error(this.apiError(err, 'Hack 提交失败'));
      }).finally(() => { this.hackSubmitting = false; });
    },
    apiError(err, fallback) {
      const detail = err && err.response && err.response.data && err.response.data.message;
      return detail ? `${fallback}：${detail}` : fallback;
    },
    statusType(s) {
      return { success: 'success', fail: 'danger', invalid: 'info', pending: 'warning', judging: 'warning' }[s] || 'info';
    },
    statusLabel(s) {
      return { success: '成功', fail: '失败', invalid: '无效', pending: '排队中', judging: '判定中' }[s] || s;
    },
  },
  mounted() {
    this.cid = this.$route.params.cid;
    this.all();
  },
  beforeUnmount() {
    clearTimeout(this.pollTimer);
  },
};
</script>

<style scoped>
.hack-panel {
  padding: 4px;
}

.hack-stats {
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 10px 0;
}

.hack-tip {
  margin-bottom: 12px;
}

.hack-code {
  max-height: 480px;
  overflow: auto;
  background: #f6f8fa;
  padding: 14px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
}

.hack-pagination {
  margin-top: 12px;
  justify-content: center;
}

@media (max-width: 768px) {
  .hack-panel {
    padding: 0;
  }

  .hack-stats {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .hack-code {
    box-sizing: border-box;
    max-width: 100%;
    padding: 10px;
    white-space: pre;
  }

  .hack-pagination {
    flex-wrap: wrap;
  }
}
</style>
