<template>
  <div style="margin: 0 20px;">
    <el-row>
      <el-col :span="8">
        <div class="header">
          操作记录
        </div>
      </el-col>
      <el-col :span="16">
        <el-pagination @current-change="handleCurrentChange" :current-page="currentPage" :page-size="10"
          layout="total, prev, pager, next" :total="total"></el-pagination>
      </el-col>
    </el-row>
    <div class="audit-filter">
      <el-select v-model="filter.eventType" placeholder="全部事件" clearable filterable style="width: 180px;" @change="onFilterChange">
        <el-option v-for="e in eventOptions" :key="e.id" :label="e.name" :value="e.id" />
      </el-select>
      <el-input v-model="filter.q" clearable placeholder="搜索 IP / 设备 / 事件 / 详情" style="width: 260px;"
        @keyup.enter="onFilterChange" @clear="onFilterChange" />
      <el-date-picker v-model="filter.timeRange" type="datetimerange" start-placeholder="开始时间" end-placeholder="结束时间"
        value-format="YYYY-MM-DD HH:mm:ss" style="width: 360px;" @change="onFilterChange" />
      <el-button type="primary" plain @click="onFilterChange">筛选</el-button>
      <el-button plain @click="resetFilter">重置</el-button>
    </div>
    <el-divider />
    <el-timeline style="margin-top:15px; padding: 0;">
      <el-timeline-item v-for="audit in eventList" :key="audit.id" style="padding: 0;"
        :color="(this.$store.state.ip === audit.ip ? '#0bbd87' : '')">
        <div>
          <span class="emphasis">{{ audit.os }}</span> / <span class="attach">{{ audit.browser }}</span>
        </div>
        <div v-if="!audit.detail" style="margin: 5px 0; font-weight: 500; font-size: 15px;">
          {{ audit.eventExp }} · <span class="attach">{{ audit.event }}</span>
        </div>
        <el-collapse v-if="audit.detail" style="margin: 5px 0;">
          <el-collapse-item>
            <template #title>
              <div style="margin: 5px 0; font-weight: 500; font-size: 15px;">
                {{ audit.eventExp }} · <span class="attach">{{ audit.event }}</span>
              </div>
            </template>
            <pre>{{ audit.detail }}</pre>
          </el-collapse-item>
        </el-collapse>
        <div class="attach"> {{ audit.ip }} ｜ {{ audit.iploc }} ｜ {{ audit.time }}</div>
        <el-divider />
      </el-timeline-item>
    </el-timeline>
  </div>
</template>

<script>
import axios from "axios";

export default {
  name: "userAudit",
  data() {
    return {
      eventList: [],
      eventKeys: [],
      eventNames: [],
      currentPage: 1,
      total: 0,
      filter: { eventType: '', q: '', timeRange: [] },
    }
  },
  computed: {
    eventOptions() {
      return (this.eventKeys || []).map((key, id) => ({
        id,
        key,
        name: `${this.eventNames[id] || key} · ${key}`,
      }));
    },
  },
  methods: {
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
    },
    onFilterChange() {
      this.currentPage = 1;
      this.all();
    },
    resetFilter() {
      this.filter = { eventType: '', q: '', timeRange: [] };
      this.onFilterChange();
    },
    requestFilter() {
      const filter = {};
      if (this.filter.eventType !== '' && this.filter.eventType != null) filter.eventType = this.filter.eventType;
      if (this.filter.q && this.filter.q.trim()) filter.q = this.filter.q.trim();
      if (this.filter.timeRange && this.filter.timeRange.length === 2) {
        filter.startTime = this.filter.timeRange[0];
        filter.endTime = this.filter.timeRange[1];
      }
      return filter;
    },
    updateUrl() {
      if (this.$route.query.tab !== 'audit') return;
      const params = new URLSearchParams();
      params.set('tab', 'audit');
      if (this.currentPage !== 1) params.set('pageId', this.currentPage);
      if (this.filter.eventType !== '' && this.filter.eventType != null) params.set('eventType', this.filter.eventType);
      if (this.filter.q && this.filter.q.trim()) params.set('q', this.filter.q.trim());
      if (this.filter.timeRange && this.filter.timeRange.length === 2) {
        params.set('startTime', this.filter.timeRange[0]);
        params.set('endTime', this.filter.timeRange[1]);
      }
      const url = `${location.pathname}?${params.toString()}`;
      history.state.current = url;
      history.replaceState(history.state, null, url);
    },
    all() {
      this.updateUrl();
      axios.post('/api/user/listAudits', {
        pageId: this.currentPage,
        filter: this.requestFilter(),
      }).then(res => {
        this.eventList = res.data.data;
        this.total = res.data.total;
        this.eventKeys = res.data.eventList || this.eventKeys;
        this.eventNames = res.data.eventExp || this.eventNames;
      });
    }
  },
  mounted() {
    if (this.$route.query.pageId) this.currentPage = parseInt(this.$route.query.pageId);
    if (this.$route.query.eventType != null) this.filter.eventType = Number(this.$route.query.eventType);
    if (this.$route.query.q) this.filter.q = this.$route.query.q;
    if (this.$route.query.startTime && this.$route.query.endTime) {
      this.filter.timeRange = [this.$route.query.startTime, this.$route.query.endTime];
    }
    this.all();
  },
}
</script>

<style scoped>
.header {
  font-size: 24px;
  font-weight: 800;
}

.audit-filter {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 14px;
}

.emphasis {
  font-size: 17px;
  font-weight: 600;
}

.attach {
  font-size: 14px;
  font-weight: 500;
  color: #7a7a7a;
}

.el-collapse {
  --el-collapse-header-height: 30px;
}

.el-collapse :deep(.el-collapse-item__content) {
  padding-bottom: 0;
}

pre {
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  display: block;
  overflow: auto;
  padding: 10px;
  margin: 0 0 10px;
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
</style>
