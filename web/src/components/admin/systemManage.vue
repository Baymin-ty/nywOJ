<template>
  <div class="system-page">
    <aside class="system-sidebar">
      <div class="sidebar-header">
        <div class="sidebar-label">ADMIN</div>
        <div class="sidebar-title">系统管理</div>
      </div>

      <div
        v-for="s in availableSections"
        :key="s.id"
        class="sidebar-item"
        :class="{ active: activeName === s.id }"
        @click="goTab(s.id)"
      >
        <el-icon :size="16"><component :is="s.icon" /></el-icon>
        <span class="sidebar-item-label">{{ s.label }}</span>
      </div>
    </aside>

    <main class="system-main">
      <component :is="currentComponent" v-if="currentComponent" :key="activeName" />
      <div v-else class="empty-panel">暂无可访问的系统管理模块</div>
    </main>
  </div>
</template>

<script>
import { markRaw } from 'vue';
import { UserFilled, DataAnalysis, Grid, DataLine, UploadFilled, Setting } from '@element-plus/icons-vue';
import { can, canAny } from '@/utils/can';

import groupManage from '@/components/group/groupManage.vue';
import judgeMonitor from '@/components/admin/judgeMonitor.vue';
import problemTagManager from '@/components/admin/problemTagManager.vue';
import ratingTool from '@/components/admin/ratingTool.vue';
import migrationTool from '@/components/admin/migrationTool.vue';
import homepageSettings from '@/components/admin/homepageSettings.vue';

export default {
  name: 'systemManage',
  data() {
    return {
      sections: [
        { id: 'groups', label: '用户组', icon: markRaw(UserFilled), can: () => canAny('user.manage', 'user.role.admin'), comp: markRaw(groupManage) },
        { id: 'judge', label: '评测监控', icon: markRaw(DataAnalysis), can: () => canAny('submission.rejudge.any', 'user.manage', 'user.role.admin'), comp: markRaw(judgeMonitor) },
        { id: 'tags', label: '题目标签', icon: markRaw(Grid), can: () => can('problem.manage.any'), comp: markRaw(problemTagManager) },
        { id: 'rating', label: 'Rating 管理', icon: markRaw(DataLine), can: () => can('user.role.admin'), comp: markRaw(ratingTool) },
        { id: 'migration', label: '迁移工具', icon: markRaw(UploadFilled), can: () => can('user.role.admin'), comp: markRaw(migrationTool) },
        { id: 'homepage', label: '首页设置', icon: markRaw(Setting), can: () => can('announcement.manage'), comp: markRaw(homepageSettings) },
      ],
    };
  },
  computed: {
    availableSections() {
      return this.sections.filter((s) => s.can());
    },
    activeName() {
      const want = this.$route.params.tab;
      const found = this.availableSections.find((s) => s.id === want);
      return found ? found.id : (this.availableSections[0] && this.availableSections[0].id) || '';
    },
    currentComponent() {
      const found = this.availableSections.find((s) => s.id === this.activeName);
      return found ? found.comp : null;
    },
  },
  watch: {
    '$route.params.tab'() {
      this.ensureCanonicalTab();
    },
    availableSections() {
      this.ensureCanonicalTab();
    },
  },
  methods: {
    goTab(name) {
      if (name && name !== this.$route.params.tab) {
        this.$router.push({ path: '/system/' + name });
      }
    },
    // Keep the URL in sync with the resolved tab so refresh / share works,
    // and bounce away from unknown or forbidden sections.
    ensureCanonicalTab() {
      if (!this.availableSections.length) {
        this.$router.replace('/');
        return;
      }
      if (this.activeName && this.$route.params.tab !== this.activeName) {
        this.$router.replace({ path: '/system/' + this.activeName });
      }
    },
  },
  mounted() {
    this.ensureCanonicalTab();
  },
};
</script>

<style scoped>
.system-page {
  --admin-bg: #eef2f6;
  --admin-surface: #ffffff;
  --admin-border: #dfe5ef;
  --admin-muted: #748094;
  --admin-text: #1f2a3d;
  --admin-accent: #2f7de1;
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr);
  gap: 14px;
  align-items: stretch;
  background:
    linear-gradient(180deg, rgba(47, 125, 225, 0.07), rgba(47, 125, 225, 0) 220px),
    var(--admin-bg);
  height: calc(100vh - 60px);
  min-height: 640px;
  overflow: hidden;
  padding: 14px;
  box-sizing: border-box;
}

.system-sidebar {
  min-width: 0;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  padding: 14px;
  overflow: auto;
  box-shadow: 0 12px 28px rgba(31, 42, 61, 0.07);
}

.sidebar-header {
  padding: 2px 4px 14px;
  margin-bottom: 10px;
  border-bottom: 1px solid #edf1f6;
}

.sidebar-label {
  font-size: 11px;
  color: var(--admin-muted);
  text-transform: uppercase;
  letter-spacing: 0;
  font-weight: 700;
  margin-bottom: 4px;
  font-family: 'Courier New', monospace;
}

.sidebar-title {
  font-size: 22px;
  font-weight: 800;
  color: var(--admin-text);
  line-height: 1.2;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0;
  padding: 11px 12px;
  font-size: 13px;
  font-weight: 700;
  color: #3b4658;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s, transform 0.15s;
}

.sidebar-item:hover {
  background: #f8fafc;
  border-color: #e7edf6;
  transform: translateX(1px);
}

.sidebar-item.active {
  color: var(--admin-accent);
  background: #edf5ff;
  border-color: #c9ddf7;
  box-shadow: inset 3px 0 0 var(--admin-accent);
}

.sidebar-item .el-icon {
  color: var(--admin-muted);
}

.sidebar-item.active .el-icon {
  color: var(--admin-accent);
}

.sidebar-item-label {
  flex: 1;
}

.system-main {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 0;
  box-sizing: border-box;
  scrollbar-gutter: stable;
}

/* Children render their own page container; strip the redundant outer
   centering so the content lines up with the sidebar shell. */
.system-main :deep(.box-card) {
  margin: 0;
}

.system-main :deep(.group-page),
.system-main :deep(.tag-page),
.system-main :deep(.monitor-page),
.system-main :deep(.rating-page),
.system-main :deep(.migration-page),
.system-main :deep(.homepage-settings) {
  max-width: none;
  margin: 0;
  padding: 0 0 18px;
}

.system-main :deep(.page-head) {
  padding: 14px 16px;
  margin-bottom: 12px;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 8px 22px rgba(31, 42, 61, 0.045);
}

.system-main :deep(.eyebrow) {
  color: var(--admin-muted);
  letter-spacing: 0;
}

.system-main :deep(h1) {
  color: var(--admin-text);
}

.system-main :deep(.panel),
.system-main :deep(.metric),
.system-main :deep(.inner-card),
.system-main :deep(.stat-strip),
.system-main :deep(.toolbar),
.system-main :deep(.user-table-wrap),
.system-main :deep(.section-header),
.system-main :deep(.matrix-wrap),
.system-main :deep(.catalog-group) {
  border-color: var(--admin-border);
  border-radius: 8px;
  box-shadow: 0 8px 22px rgba(31, 42, 61, 0.045);
}

.empty-panel {
  background: var(--admin-surface);
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  padding: 48px;
  text-align: center;
  color: var(--admin-muted);
  font-size: 13px;
}

@media (max-width: 768px) {
  .system-page {
    grid-template-columns: 1fr;
    height: auto;
    min-height: calc(100vh - 60px);
    padding: 10px;
  }

  .system-sidebar {
    width: 100%;
    padding: 10px 0 6px;
  }

  .sidebar-header {
    padding: 0 14px 8px;
  }

  .system-sidebar {
    display: flex;
    align-items: center;
    overflow-x: auto;
  }

  .sidebar-header {
    flex: 0 0 auto;
    min-width: 150px;
  }

  .sidebar-item {
    flex: 0 0 auto;
    border: 1px solid transparent;
    padding: 9px 12px;
    width: 190px;
  }

  .sidebar-item.active {
    border-color: #c9ddf7;
    background: #edf5ff;
  }

  .system-main {
    overflow: visible;
  }
}
</style>
