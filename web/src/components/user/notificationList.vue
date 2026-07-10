<template>
  <div class="noti-list-page">
    <div class="noti-list-head">
      <h2>通知</h2>
      <el-button v-if="unread > 0" size="small" @click="markAllRead">全部标记已读</el-button>
    </div>

    <el-empty v-if="!loading && !items.length" description="暂无通知" />

    <div v-loading="loading">
      <div
        v-for="n in items"
        :key="n.nid"
        class="noti-row"
        :class="{ unread: !n.isRead }"
        @click="open(n)"
      >
        <div class="noti-row-main">
          <div class="noti-row-title">
            <el-tag v-if="!n.isRead" size="small" type="primary" effect="plain">未读</el-tag>
            {{ n.title }}
          </div>
          <div class="noti-row-content" v-if="n.content">{{ n.content }}</div>
        </div>
        <div class="noti-row-time">{{ formatTime(n.createdAt) }}</div>
      </div>
    </div>

    <el-pagination
      v-if="total > pageSize"
      class="noti-pager"
      layout="prev, pager, next"
      :total="total"
      :page-size="pageSize"
      :current-page="pageId"
      @current-change="changePage"
      background
    />
  </div>
</template>

<script>
import axios from "axios";

export default {
  name: "notificationList",
  data() {
    return {
      items: [],
      total: 0,
      unread: 0,
      pageId: 1,
      pageSize: 20,
      loading: false,
    };
  },
  mounted() {
    if (!this.$store.state.uid) {
      this.$router.push("/user/login");
      return;
    }
    this.load();
  },
  methods: {
    load() {
      this.loading = true;
      axios
        .post("/api/notification/getNotifications", { pageId: this.pageId, pageSize: this.pageSize })
        .then((r) => {
          if (r.data) {
            this.items = r.data.data || [];
            this.total = r.data.total || 0;
            this.unread = r.data.unread || 0;
          }
        })
        .finally(() => {
          this.loading = false;
        });
    },
    changePage(p) {
      this.pageId = p;
      this.load();
    },
    open(n) {
      if (!n.isRead) {
        axios.post("/api/notification/markRead", { nids: [n.nid] }).then(() => {
          n.isRead = 1;
          this.unread = Math.max(0, this.unread - 1);
        });
      }
      if (n.link) this.$router.push(n.link);
    },
    markAllRead() {
      axios.post("/api/notification/markAllRead").then(() => {
        this.items.forEach((n) => { n.isRead = 1; });
        this.unread = 0;
      });
    },
    formatTime(t) {
      if (!t) return "";
      return new Date(t).toLocaleString();
    },
  },
};
</script>

<style scoped>
.noti-list-page {
  max-width: 760px;
  margin: 20px auto;
  padding: 0 16px;
}
.noti-list-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.noti-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
  border-radius: 6px;
}
.noti-row:hover {
  background: var(--el-fill-color-light);
}
.noti-row.unread {
  background: var(--el-color-primary-light-9);
}
.noti-row-title {
  font-weight: 500;
}
.noti-row-content {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
.noti-row-time {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  white-space: nowrap;
}
.noti-pager {
  margin-top: 16px;
  justify-content: center;
}
</style>
