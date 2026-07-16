<template>
  <div class="site-header">
  <el-menu class="desktop-nav" mode="horizontal" :default-active="this.$store.state.activeTitle" :router="true">
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
          <span class="sr-only">通知</span>
        </el-badge>
      </template>
      <div class="noti-panel">
        <div class="noti-head">
          <span>通知</span>
          <el-button v-if="unreadCount > 0" class="noti-mark-all" link type="primary" @click.stop="markAllRead">全部已读</el-button>
        </div>
        <el-empty v-if="!notifications.length" description="暂无通知" :image-size="60" />
        <div v-else>
          <button v-for="n in notifications" :key="n.nid" type="button" class="noti-item" :class="{ unread: !n.isRead }" @click="goNotification(n)">
            <div class="noti-title">{{ n.title }}</div>
            <div class="noti-content" v-if="n.content">{{ n.content }}</div>
            <div class="noti-time">{{ formatTime(n.createdAt) }}</div>
          </button>
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

  <div class="mobile-nav" role="navigation" aria-label="移动端主导航">
    <el-button class="mobile-menu-button" text circle aria-label="打开主菜单" @click="mobileNavOpen = true">
      <el-icon :size="24"><Menu /></el-icon>
    </el-button>
    <router-link class="mobile-brand" to="/" aria-label="返回首页">
      <img src="../assets/icon.png" class="mobile-brand-icon" alt="nywOJ">
    </router-link>
    <span class="mobile-page-title">{{ mobilePageTitle }}</span>
    <div class="mobile-actions">
      <el-button
        v-if="this.$store.state.uid"
        class="mobile-action-button"
        text
        circle
        aria-label="查看通知"
        @click="openMobileNotifications"
      >
        <el-badge :value="unreadCount" :max="99" :hidden="unreadCount === 0">
          <el-icon :size="20"><Bell /></el-icon>
        </el-badge>
      </el-button>
      <el-dropdown
        v-if="this.$store.state.uid"
        trigger="click"
        placement="bottom-end"
        popper-class="mobile-user-dropdown"
        @command="handleMobileUserCommand"
      >
        <button type="button" class="mobile-avatar-button" aria-label="打开用户菜单">
          <el-avatar :size="32" :src="this.$store.state.avatar" />
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item :command="`/user/${this.$store.state.uid}`">
              <el-icon><UserFilled /></el-icon>个人主页
            </el-dropdown-item>
            <el-dropdown-item command="/user/edit">
              <el-icon><Edit /></el-icon>编辑资料
            </el-dropdown-item>
            <el-dropdown-item
              v-if="$canAny('group.manage','judge.monitor.view','judge.client.manage','problem.tag.manage','system.rating.manage','system.migration.manage','system.homepage.manage')"
              command="/system"
            >
              <el-icon><Setting /></el-icon>系统管理
            </el-dropdown-item>
            <el-dropdown-item v-if="$canAny('user.manage','user.role.admin')" command="/admin/permissions">
              <el-icon><Lock /></el-icon>权限管理
            </el-dropdown-item>
            <el-dropdown-item command="/paste">
              <el-icon><Document /></el-icon>剪贴板
            </el-dropdown-item>
            <el-dropdown-item v-if="$canAny('user.manage')" command="__broadcast" divided>
              <el-icon><Promotion /></el-icon>发送广播
            </el-dropdown-item>
            <el-dropdown-item command="__logout" :divided="!$canAny('user.manage')">
              <el-icon><Close /></el-icon>退出登录
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button v-else class="mobile-login-button" type="primary" size="small" @click="$router.push('/user/login')">
        登录
      </el-button>
    </div>
  </div>
  </div>

  <el-drawer
    v-model="mobileNavOpen"
    class="mobile-nav-drawer"
    title="主菜单"
    direction="ltr"
    size="min(86vw, 360px)"
    :with-header="false"
    append-to-body
  >
    <div class="mobile-drawer-head">
      <img src="../assets/icon.png" class="mobile-drawer-logo" alt="">
      <div>
        <strong>nywOJ</strong>
        <small v-if="this.$store.state.uid">{{ this.$store.state.name }}</small>
        <small v-else>在线评测平台</small>
      </div>
      <el-button text circle aria-label="关闭主菜单" @click="mobileNavOpen = false">
        <el-icon :size="22"><Close /></el-icon>
      </el-button>
    </div>
    <el-menu
      class="mobile-drawer-menu"
      :default-active="this.$store.state.activeTitle"
      :router="true"
      @select="mobileNavOpen = false"
    >
      <el-menu-item index="/"><el-icon><Lollipop /></el-icon><span>首页</span></el-menu-item>
      <el-menu-item index="/problem"><el-icon><Files /></el-icon><span>题库</span></el-menu-item>
      <el-menu-item index="/ide"><el-icon><Monitor /></el-icon><span>在线 IDE</span></el-menu-item>
      <el-menu-item index="/contest"><el-icon><Trophy /></el-icon><span>比赛</span></el-menu-item>
      <el-menu-item index="/homework"><el-icon><Notebook /></el-icon><span>作业</span></el-menu-item>
      <el-menu-item index="/submission"><el-icon><DataAnalysis /></el-icon><span>提交记录</span></el-menu-item>
      <el-menu-item index="/users"><el-icon><UserFilled /></el-icon><span>用户榜</span></el-menu-item>
      <el-menu-item index="/discussion"><el-icon><Document /></el-icon><span>讨论</span></el-menu-item>
      <el-menu-item index="/rabbit"><el-icon><MagicStick /></el-icon><span>可爱兔兔</span></el-menu-item>
      <template v-if="!this.$store.state.uid">
        <el-divider />
        <el-menu-item index="/user/login"><el-icon><User /></el-icon><span>登录</span></el-menu-item>
        <el-menu-item index="/user/reg"><el-icon><CircleCheck /></el-icon><span>注册</span></el-menu-item>
      </template>
    </el-menu>
  </el-drawer>

  <el-drawer
    v-model="mobileNotificationsOpen"
    class="mobile-notification-drawer"
    title="通知"
    direction="rtl"
    size="min(92vw, 380px)"
    :with-header="false"
    append-to-body
  >
    <div class="mobile-notification-head">
      <strong>通知</strong>
      <el-button text circle aria-label="关闭通知" @click="mobileNotificationsOpen = false">
        <el-icon :size="22"><Close /></el-icon>
      </el-button>
    </div>
    <div class="mobile-notification-body">
      <div class="noti-head">
        <span>{{ unreadCount ? `${unreadCount} 条未读` : '全部已读' }}</span>
        <el-button v-if="unreadCount > 0" class="noti-mark-all" link type="primary" @click="markAllRead">全部已读</el-button>
      </div>
      <el-empty v-if="!notifications.length" description="暂无通知" :image-size="72" />
      <div v-else>
        <button v-for="n in notifications" :key="n.nid" type="button" class="noti-item" :class="{ unread: !n.isRead }" @click="goNotification(n)">
          <div class="noti-title">{{ n.title }}</div>
          <div class="noti-content" v-if="n.content">{{ n.content }}</div>
          <div class="noti-time">{{ formatTime(n.createdAt) }}</div>
        </button>
      </div>
      <div class="noti-foot">
        <router-link to="/notifications" @click="mobileNotificationsOpen = false">查看全部通知</router-link>
      </div>
    </div>
  </el-drawer>

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
      mobileNavOpen: false,
      mobileNotificationsOpen: false,
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
  computed: {
    mobilePageTitle() {
      return (this.$route.meta && this.$route.meta.title) || 'nywOJ';
    },
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
      this.mobileNavOpen = false;
      this.mobileNotificationsOpen = false;
      if (this.$store.state.uid) this.fetchUnread();
    }
  },
  methods: {
    logout() {
      axios.post('/api/user/logout').then(() => {
        this.mobileNavOpen = false;
        this.mobileNotificationsOpen = false;
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
      this.mobileNotificationsOpen = false;
      this.closeMenus();
      if (n.link) this.$router.push(n.link);
    },
    openMobileNotifications() {
      this.mobileNotificationsOpen = true;
      this.refreshNotifications();
    },
    handleMobileUserCommand(command) {
      if (command === '__logout') {
        this.logout();
        return;
      }
      if (command === '__broadcast') {
        this.broadcastDialog = true;
        return;
      }
      if (command) this.$router.push(command);
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
.site-header {
  width: 100%;
  background: var(--el-bg-color);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.desktop-nav {
  justify-content: center;
}

.mobile-nav {
  display: none;
}

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

.noti-badge .el-badge__content {
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
  display: block;
  width: 100%;
  padding: 8px 14px;
  cursor: pointer;
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
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

.noti-mark-all {
  min-height: 32px;
  padding: 0 4px;
}

.mobile-drawer-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-height: 64px;
  padding: 10px 12px;
  box-sizing: border-box;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.mobile-drawer-logo {
  width: 40px;
  height: 40px;
  border-radius: 8px;
}

.mobile-drawer-head strong,
.mobile-drawer-head small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-drawer-head small {
  margin-top: 2px;
  color: var(--el-text-color-secondary);
}

.mobile-nav-drawer .el-drawer__body,
.mobile-notification-drawer .el-drawer__body {
  display: flex;
  flex-direction: column;
  padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
  box-sizing: border-box;
  overflow: hidden;
}

.mobile-drawer-menu {
  flex: 1 1 auto;
  min-height: 0;
  padding: 8px;
  overflow-y: auto;
  border-right: 0;
}

.mobile-drawer-menu .el-menu-item {
  height: 48px;
  margin: 2px 0;
  border-radius: 8px;
}

.mobile-notification-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  padding: 4px 12px 4px 16px;
  box-sizing: border-box;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.mobile-notification-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.mobile-notification-body .noti-head {
  min-height: 38px;
  padding-top: 8px;
}

.mobile-notification-body .noti-item {
  padding: 12px 14px;
}

@media (max-width: 900px) {
  .desktop-nav {
    display: none;
  }

  .site-header {
    height: calc(56px + env(safe-area-inset-top));
    padding-top: env(safe-area-inset-top);
    box-sizing: border-box;
    border-bottom: 1px solid var(--el-border-color-lighter);
    box-shadow: 0 1px 8px rgb(0 0 0 / 5%);
  }

  .mobile-nav {
    display: grid;
    grid-template-columns: 44px 36px minmax(0, 1fr) auto;
    gap: 4px;
    align-items: center;
    height: 56px;
    padding: 0 max(8px, env(safe-area-inset-right)) 0 max(6px, env(safe-area-inset-left));
    box-sizing: border-box;
  }

  .mobile-menu-button,
  .mobile-action-button {
    width: 44px;
    height: 44px;
    margin: 0;
  }

  .mobile-brand {
    display: grid;
    place-items: center;
    width: 36px;
    height: 40px;
  }

  .mobile-brand-icon {
    width: 32px;
    height: 32px;
    border-radius: 6px;
  }

  .mobile-page-title {
    min-width: 0;
    padding-left: 4px;
    overflow: hidden;
    color: var(--el-text-color-primary);
    font-size: 15px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mobile-actions {
    display: flex;
    gap: 2px;
    align-items: center;
    justify-content: flex-end;
  }

  .mobile-avatar-button {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    outline: none;
    background: transparent;
  }

  .mobile-avatar-button:focus-visible {
    box-shadow: 0 0 0 2px var(--el-color-primary-light-5);
  }

  .mobile-login-button {
    min-width: 52px;
    min-height: 44px;
  }

  .mobile-drawer-head > .el-button,
  .mobile-notification-head > .el-button {
    width: 44px;
    height: 44px;
  }

  .mobile-user-dropdown .el-dropdown-menu__item {
    min-height: 44px;
    padding: 0 16px;
  }
}
</style>
