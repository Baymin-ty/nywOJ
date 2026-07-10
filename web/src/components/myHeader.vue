<template>
  <el-menu mode="horizontal" :default-active="this.$store.state.activeTitle" :router="true">
    <el-menu-item index="/rabbit" style="height: auto">
      <img style="margin-top: 3px;" src="../assets/icon.png" class="icon">
    </el-menu-item>
    <el-menu-item index="/">
      <el-icon>
        <Lollipop />
      </el-icon>
      首页
    </el-menu-item>
    <el-menu-item index="/problem">
      <el-icon>
        <Files />
      </el-icon>
      题库
    </el-menu-item>
    <el-menu-item index="/ide">
      <el-icon>
        <Monitor />
      </el-icon>
      在线IDE
    </el-menu-item>
    <el-menu-item index="/contest">
      <el-icon>
        <Trophy />
      </el-icon>
      比赛
    </el-menu-item>
    <el-menu-item index="/homework">
      <el-icon>
        <Notebook />
      </el-icon>
      作业
    </el-menu-item>
    <el-menu-item index="/submission">
      <el-icon>
        <DataAnalysis />
      </el-icon>
      提交记录
    </el-menu-item>
    <el-menu-item index="/users">
      <el-icon>
        <UserFilled />
      </el-icon>
      用户榜
    </el-menu-item>
    <el-menu-item index="/discussion">
      <el-icon>
        <Document />
      </el-icon>
      讨论
    </el-menu-item>
    <el-menu-item v-if="!this.$store.state.uid" index="/user/login">
      <el-icon>
        <User />
      </el-icon>
      登录
    </el-menu-item>
    <el-menu-item v-if="!this.$store.state.uid" index="/user/reg">
      <el-icon>
        <CircleCheck />
      </el-icon>
      注册
    </el-menu-item>
    <el-sub-menu index="__noti" v-if="this.$store.state.uid" class="noti-menu">
      <template #title>
        <el-badge :value="unreadCount" :max="99" :hidden="unreadCount === 0" class="noti-badge">
          <el-icon><Bell /></el-icon>
        </el-badge>
      </template>
      <div class="noti-panel">
        <div class="noti-head">
          <span>通知</span>
          <el-link type="primary" :underline="false" @click.stop="markAllRead" v-if="unreadCount > 0">全部已读</el-link>
        </div>
        <el-empty v-if="!notifications.length" description="暂无通知" :image-size="60" />
        <div v-else>
          <div v-for="n in notifications" :key="n.nid" class="noti-item" :class="{ unread: !n.isRead }" @click="goNotification(n)">
            <div class="noti-title">{{ n.title }}</div>
            <div class="noti-content" v-if="n.content">{{ n.content }}</div>
            <div class="noti-time">{{ formatTime(n.createdAt) }}</div>
          </div>
        </div>
        <div class="noti-foot">
          <router-link to="/notifications" @click="closeMenus">查看全部</router-link>
        </div>
      </div>
    </el-sub-menu>
    <el-sub-menu index="/user" v-if="this.$store.state.uid">
      <template #title>
        <el-avatar :size="35" :src="this.$store.state.avatar" />
        <span style="padding-left: 8px;"> {{ this.$store.state.name }} </span>
      </template>
      <el-menu-item :index="/user/ + this.$store.state.uid">
        <el-icon>
          <UserFilled />
        </el-icon>
        个人主页
      </el-menu-item>
      <el-menu-item index="/user/edit">
        <el-icon>
          <Edit />
        </el-icon>
        编辑资料
      </el-menu-item>
      <el-menu-item v-if="$canAny('group.manage','judge.monitor.view','judge.client.manage','problem.tag.manage','system.rating.manage','system.migration.manage','system.homepage.manage')" index="/system">
        <el-icon>
          <Setting />
        </el-icon>
        系统管理
      </el-menu-item>
      <el-menu-item v-if="$canAny('user.manage','user.role.admin')" index="/admin/permissions">
        <el-icon>
          <Lock />
        </el-icon>
        权限管理
      </el-menu-item>
      <span v-if="$canAny('user.manage')" @click="broadcastDialog = true">
        <el-menu-item>
          <el-icon>
            <Promotion />
          </el-icon>
          发送广播
        </el-menu-item>
      </span>
      <el-menu-item index="/paste">
        <el-icon>
          <Document />
        </el-icon>
        剪贴板
      </el-menu-item>
      <span @click="logout">
        <el-menu-item>
          <el-icon>
            <Close />
          </el-icon>
          退出登录
        </el-menu-item>
      </span>
    </el-sub-menu>
  </el-menu>

  <el-dialog v-model="broadcastDialog" title="发送全站广播" width="480px">
    <el-form label-width="60px">
      <el-form-item label="标题">
        <el-input v-model="broadcast.title" maxlength="255" placeholder="广播标题（必填）" />
      </el-form-item>
      <el-form-item label="内容">
        <el-input v-model="broadcast.content" type="textarea" :rows="3" maxlength="4000" placeholder="广播内容（可选）" />
      </el-form-item>
      <el-form-item label="链接">
        <el-input v-model="broadcast.link" placeholder="点击跳转路径，如 /contest/1（可选）" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="broadcastDialog = false">取消</el-button>
      <el-button type="primary" :loading="broadcasting" @click="sendBroadcast">发送给所有用户</el-button>
    </template>
  </el-dialog>
</template>

<script>
import axios from "axios";

export default {
  name: "myHeader",
  data() {
    return {
      uid: 0,
      name: "/",
      money: 50,
      curPath: '',
      unreadCount: 0,
      notifications: [],
      notiTimer: null,
      broadcastDialog: false,
      broadcasting: false,
      broadcast: { title: '', content: '', link: '' },
      options: [{
        value: 50,
        label: '一包辣条',
      }, {
        value: 100,
        label: '一根冰棍',
      }, {
        value: 300,
        label: '一瓶可乐',
      }],
    }
  },
  mounted() {
    if (this.$store.state.uid) {
      this.refreshNotifications();
      this.notiTimer = setInterval(() => this.fetchUnread(), 60000);
    }
  },
  beforeUnmount() {
    if (this.notiTimer) clearInterval(this.notiTimer);
  },
  watch: {
    '$store.state.uid'(val) {
      if (val) {
        this.refreshNotifications();
        if (!this.notiTimer) this.notiTimer = setInterval(() => this.fetchUnread(), 60000);
      } else {
        this.unreadCount = 0;
        this.notifications = [];
        if (this.notiTimer) { clearInterval(this.notiTimer); this.notiTimer = null; }
      }
    },
    '$route'() {
      if (this.$store.state.uid) this.fetchUnread();
    }
  },
  methods: {
    logout() {
      axios.post('/api/user/logout').then(() => {
        this.$store.state.uid = 0;
        this.$store.state.name = '/';
        this.$store.commit('setPermissions', []);
        this.$router.push('/');
      });
    },
    fetchUnread() {
      if (!this.$store.state.uid) return;
      axios.post('/api/notification/getUnreadCount').then((r) => {
        this.unreadCount = (r.data && r.data.unread) || 0;
      }).catch(() => {});
    },
    refreshNotifications() {
      if (!this.$store.state.uid) return;
      axios.post('/api/notification/getNotifications', { pageId: 1, pageSize: 10 }).then((r) => {
        if (r.data) {
          this.notifications = r.data.data || [];
          this.unreadCount = r.data.unread || 0;
        }
      }).catch(() => {});
    },
    goNotification(n) {
      const nids = n.isRead ? [] : [n.nid];
      if (nids.length) {
        axios.post('/api/notification/markRead', { nids }).then(() => {
          n.isRead = 1;
          this.unreadCount = Math.max(0, this.unreadCount - 1);
        }).catch(() => {});
      }
      this.closeMenus();
      if (n.link) this.$router.push(n.link);
    },
    markAllRead() {
      axios.post('/api/notification/markAllRead').then(() => {
        this.notifications.forEach((n) => { n.isRead = 1; });
        this.unreadCount = 0;
      }).catch(() => {});
    },
    closeMenus() {
      // 点击后收起菜单弹层（触发一次路由/失焦即可，Element 会自行收起）
      document.activeElement && document.activeElement.blur && document.activeElement.blur();
    },
    formatTime(t) {
      if (!t) return '';
      const d = new Date(t);
      const diff = (Date.now() - d.getTime()) / 1000;
      if (diff < 60) return '刚刚';
      if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
      if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
      return d.toLocaleDateString();
    },
    sendBroadcast() {
      const title = (this.broadcast.title || '').trim();
      if (!title) { this.$message.warning('请填写广播标题'); return; }
      this.broadcasting = true;
      axios.post('/api/notification/broadcast', {
        title,
        content: this.broadcast.content || '',
        link: this.broadcast.link || '',
      }).then((r) => {
        this.$message.success(`广播已发送给 ${(r.data && r.data.sent) || 0} 位用户`);
        this.broadcastDialog = false;
        this.broadcast = { title: '', content: '', link: '' };
      }).catch(() => {
        this.$message.error('广播发送失败');
      }).finally(() => {
        this.broadcasting = false;
      });
    }
  }
}
</script>

<style>
.icon {
  border-radius: 5px;
  width: 40px;
  height: 40px;
}

.pd .el-dialog__body {
  padding: 0;
}

.el-divider--horizontal {
  margin: 10px 0;
}

.el-menu--collapse .el-menu .el-submenu,
.el-menu--popup {
  min-width: 100px !important;
  font-size: 10px;
}

.el-menu {
  justify-content: center;
}

.noti-badge :deep(.el-badge__content) {
  top: 6px;
}

.noti-panel {
  width: 320px;
  max-width: 90vw;
}

.noti-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 14px 8px;
  font-weight: 600;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.noti-item {
  padding: 8px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.noti-item:hover {
  background: var(--el-fill-color-light);
}

.noti-item.unread {
  background: var(--el-color-primary-light-9);
}

.noti-title {
  font-size: 13px;
  font-weight: 500;
  white-space: normal;
  line-height: 1.4;
}

.noti-content {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.noti-time {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  margin-top: 2px;
}

.noti-foot {
  text-align: center;
  padding: 8px;
}

@media (max-width: 768px) {
  .el-menu {
    justify-content: flex-start;
    overflow-x: auto;
    overflow-y: hidden;
    white-space: nowrap;
    scrollbar-width: none;
  }

  .el-menu::-webkit-scrollbar {
    display: none;
  }

  .el-menu--horizontal > .el-menu-item,
  .el-menu--horizontal > .el-sub-menu .el-sub-menu__title {
    padding: 0 10px;
  }

  .icon {
    width: 34px;
    height: 34px;
  }
}
</style>
