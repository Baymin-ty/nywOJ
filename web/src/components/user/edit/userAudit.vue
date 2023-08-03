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
      currentPage: 1,
      total: 0,
    }
  },
  methods: {
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
    },
    all() {
      let url = location.pathname + '?tab=audit';
      if (this.currentPage !== 1)
        url += ('&pageId=' + this.currentPage);
      history.state.current = url;
      history.replaceState(history.state, null, url);
      axios.post('/api/user/listAudits', {
        pageId: this.currentPage
      }).then(res => {
        this.eventList = res.data.data;
        this.total = res.data.total;
      });
    }
  },
  mounted() {
    if (this.$route.query.pageId) this.currentPage = parseInt(this.$route.query.pageId);
    this.all();
  },
}
</script>

<style scoped>
.header {
  font-size: 24px;
  font-weight: 800;
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