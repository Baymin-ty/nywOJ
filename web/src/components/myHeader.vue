<template>
  <div class="header-root">
    <!-- Desktop nav -->
    <nav class="nav-desktop">
      <!-- Logo -->
      <router-link to="/rabbit" class="nav-logo">
        <img src="../assets/icon.png" class="nav-icon" alt="nywOJ" />
      </router-link>

      <!-- Nav items -->
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="nav-item"
        :class="{ 'nav-item--active': isActive(item.path) }"
      >
        <el-icon><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </router-link>

      <div class="nav-spacer"></div>

      <!-- Guest -->
      <template v-if="!$store.state.uid">
        <router-link to="/user/login" class="nav-item">
          <el-icon><User /></el-icon><span>登录</span>
        </router-link>
        <router-link to="/user/reg" class="nav-item nav-item--reg">
          <el-icon><CircleCheck /></el-icon><span>注册</span>
        </router-link>
      </template>

      <!-- Logged in -->
      <el-dropdown v-else trigger="click" @command="handleCommand">
        <div class="nav-user">
          <el-avatar :size="32" :src="$store.state.avatar" />
          <span class="nav-username">{{ $store.state.name }}</span>
          <el-icon class="nav-caret"><ArrowDown /></el-icon>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="profile">
              <el-icon><UserFilled /></el-icon> 个人主页
            </el-dropdown-item>
            <el-dropdown-item command="edit">
              <el-icon><Edit /></el-icon> 编辑资料
            </el-dropdown-item>
            <el-dropdown-item v-if="$store.state.gid === 3" command="admin">
              <el-icon><Operation /></el-icon> 用户管理
            </el-dropdown-item>
            <el-dropdown-item command="paste">
              <el-icon><Document /></el-icon> 剪贴板
            </el-dropdown-item>
            <el-dropdown-item divided command="logout">
              <el-icon><SwitchButton /></el-icon> 退出登录
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </nav>

    <!-- Mobile nav -->
    <nav class="nav-mobile">
      <router-link to="/rabbit" class="nav-logo">
        <img src="../assets/icon.png" class="nav-icon" alt="nywOJ" />
      </router-link>
      <span class="nav-mobile-title">nywOJ</span>
      <div class="nav-spacer"></div>
      <button class="hamburger" @click="mobileOpen = !mobileOpen" :aria-expanded="mobileOpen">
        <span></span><span></span><span></span>
      </button>
    </nav>

    <!-- Mobile drawer -->
    <transition name="drawer">
      <div v-if="mobileOpen" class="mobile-drawer">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="drawer-item"
          @click="mobileOpen = false"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </router-link>
        <div class="drawer-divider"></div>
        <template v-if="!$store.state.uid">
          <router-link to="/user/login" class="drawer-item" @click="mobileOpen = false">
            <el-icon><User /></el-icon><span>登录</span>
          </router-link>
          <router-link to="/user/reg" class="drawer-item" @click="mobileOpen = false">
            <el-icon><CircleCheck /></el-icon><span>注册</span>
          </router-link>
        </template>
        <template v-else>
          <div class="drawer-user">
            <el-avatar :size="36" :src="$store.state.avatar" />
            <span>{{ $store.state.name }}</span>
          </div>
          <router-link :to="'/user/' + $store.state.uid" class="drawer-item" @click="mobileOpen = false">
            <el-icon><UserFilled /></el-icon><span>个人主页</span>
          </router-link>
          <router-link to="/user/edit" class="drawer-item" @click="mobileOpen = false">
            <el-icon><Edit /></el-icon><span>编辑资料</span>
          </router-link>
          <router-link v-if="$store.state.gid === 3" to="/admin/usermanage" class="drawer-item" @click="mobileOpen = false">
            <el-icon><Operation /></el-icon><span>用户管理</span>
          </router-link>
          <router-link to="/paste" class="drawer-item" @click="mobileOpen = false">
            <el-icon><Document /></el-icon><span>剪贴板</span>
          </router-link>
          <div class="drawer-item drawer-item--danger" @click="logout">
            <el-icon><SwitchButton /></el-icon><span>退出登录</span>
          </div>
        </template>
      </div>
    </transition>
    <div v-if="mobileOpen" class="drawer-mask" @click="mobileOpen = false"></div>
  </div>
</template>

<script>
import axios from "axios";

export default {
  name: "myHeader",
  data() {
    return {
      mobileOpen: false,
      navItems: [
        { path: '/',           label: '首页',   icon: 'Lollipop'     },
        { path: '/problem',    label: '题库',   icon: 'Files'        },
        { path: '/contest',    label: '比赛',   icon: 'Trophy'       },
        { path: '/submission', label: '提交记录', icon: 'DataAnalysis' },
      ],
    };
  },
  methods: {
    isActive(path) {
      if (path === '/') return this.$route.path === '/';
      return this.$route.path.startsWith(path);
    },
    handleCommand(cmd) {
      const map = {
        profile: '/user/' + this.$store.state.uid,
        edit:    '/user/edit',
        admin:   '/admin/usermanage',
        paste:   '/paste',
        logout:  null,
      };
      if (cmd === 'logout') { this.logout(); return; }
      this.$router.push(map[cmd]);
    },
    logout() {
      axios.post('/api/user/logout').then(() => {
        this.$store.state.uid = 0;
        this.$store.state.name = '/';
        this.$store.state.gid = 0;
        this.mobileOpen = false;
        this.$router.push('/');
      });
    },
  },
}
</script>

<style scoped>
/* ── Shared ──────────────────────────────────────────────── */
.header-root {
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  position: relative;
}

.nav-logo { display: flex; align-items: center; padding: 0 10px; height: 100%; }
.nav-icon  { width: 38px; height: 38px; border-radius: 6px; display: block; }
.nav-spacer { flex: 1; }

/* ── Desktop ─────────────────────────────────────────────── */
.nav-desktop {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 60px;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 8px;
}

.nav-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 16px;
  height: 60px;
  font-size: 14px;
  color: #303133;
  text-decoration: none;
  border-bottom: 2px solid transparent;
  transition: color 0.2s, border-color 0.2s;
  white-space: nowrap;
  cursor: pointer;
}
.nav-item:hover { color: #409EFF; }
.nav-item--active { color: #409EFF; border-bottom-color: #409EFF; }

.nav-item--reg {
  margin-left: 4px;
  border: 1px solid #409EFF;
  border-radius: 20px;
  height: 34px;
  padding: 0 14px;
  color: #409EFF;
  font-size: 13px;
}
.nav-item--reg:hover { background: #ecf5ff; }

.nav-user {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 60px;
  cursor: pointer;
  color: #303133;
  font-size: 14px;
}
.nav-user:hover { color: #409EFF; }
.nav-username { max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-caret { font-size: 12px; color: #909399; }

/* ── Mobile ──────────────────────────────────────────────── */
.nav-mobile {
  display: none;
  align-items: center;
  height: 54px;
  padding: 0 12px;
}
.nav-mobile-title {
  font-size: 16px;
  font-weight: 700;
  color: #2c3e50;
  margin-left: 4px;
}

.hamburger {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 24px;
  height: 18px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.hamburger span {
  display: block;
  height: 2px;
  background: #303133;
  border-radius: 2px;
  transition: all 0.2s;
}

/* ── Drawer ──────────────────────────────────────────────── */
.mobile-drawer {
  position: fixed;
  top: 54px;
  left: 0;
  right: 0;
  background: #fff;
  border-top: 1px solid #ebeef5;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  z-index: 999;
  padding: 8px 0 16px;
}

.drawer-mask {
  position: fixed;
  inset: 0;
  top: 54px;
  background: rgba(0,0,0,0.2);
  z-index: 998;
}

.drawer-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  font-size: 15px;
  color: #303133;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s;
}
.drawer-item:hover { background: #f5f7fa; }
.drawer-item--danger { color: #f56c6c; }

.drawer-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  font-size: 15px;
  font-weight: 600;
  color: #2c3e50;
  background: #f5f7fa;
  margin-bottom: 4px;
}

.drawer-divider {
  height: 1px;
  background: #f0f0f0;
  margin: 6px 0;
}

/* ── Drawer transition ───────────────────────────────────── */
.drawer-enter-active, .drawer-leave-active { transition: opacity 0.18s, transform 0.18s; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; transform: translateY(-8px); }

/* ── Breakpoint ──────────────────────────────────────────── */
@media (max-width: 768px) {
  .nav-desktop { display: none; }
  .nav-mobile  { display: flex; }
}
</style>
