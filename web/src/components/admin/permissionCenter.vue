<template>
  <div class="perm-page">
    <!-- Sidebar -->
    <aside class="perm-sidebar">
      <div class="sidebar-header">
        <div class="sidebar-label">ADMIN</div>
        <div class="sidebar-title">权限管理中心</div>
      </div>
      <div
        v-for="item in sidebarItems"
        :key="item.id"
        class="sidebar-item"
        :class="{ active: activeTab === item.id }"
        @click="activeTab = item.id"
      >
        <el-icon :size="16"><component :is="item.icon" /></el-icon>
        <span class="sidebar-item-label">{{ item.label }}</span>
        <span v-if="item.badge != null" class="sidebar-badge" :class="{ active: activeTab === item.id }">
          {{ item.badge }}
        </span>
      </div>
      <div class="sidebar-footer">
        <div class="sidebar-footer-title">RBAC v2 · next</div>
      </div>
    </aside>

    <!-- Main content -->
    <main class="perm-main">
      <!-- Users tab -->
      <div v-if="activeTab === 'users'">
        <!-- Stats strip -->
        <div class="stat-strip" v-if="stats">
          <div v-for="(s, i) in statItems" :key="s.label" class="stat-item" :style="{ borderRight: i < statItems.length - 1 ? '1px solid #ebeef5' : 'none' }">
            <div class="stat-icon" :style="{ background: s.color + '15', color: s.color }">
              <el-icon :size="18"><component :is="s.icon" /></el-icon>
            </div>
            <div>
              <div class="stat-value">{{ s.value }}</div>
              <div class="stat-label-text">{{ s.label }}</div>
            </div>
          </div>
        </div>

        <!-- Toolbar -->
        <div class="toolbar">
          <div class="search-box">
            <el-icon class="search-icon"><Search /></el-icon>
            <input v-model="filter.q" placeholder="搜索 用户名 / UID / 邮箱" class="search-input" @keyup.enter="onFilterChange" @input="onSearchInput" />
          </div>
          <el-select v-model="filter.roleKey" placeholder="全部角色" clearable size="default" style="width: 160px;" @change="onFilterChange">
            <el-option label="（无角色）" value="__none__" />
            <el-option v-for="r in roles" :key="r.key" :label="r.name" :value="r.key" />
          </el-select>
          <el-select v-model="filter.inUse" placeholder="全部状态" clearable size="default" style="width: 110px;" @change="onFilterChange">
            <el-option label="正常" :value="1" />
            <el-option label="封禁" :value="0" />
          </el-select>
          <div style="flex: 1;" />
          <div v-if="selected.size > 0" class="batch-bar">
            已选 {{ selected.size }}
            <el-button size="small" type="primary" plain @click="batchChangeRole">批量改角色</el-button>
            <el-button size="small" type="danger" plain @click="batchBan">批量封禁</el-button>
            <el-icon style="cursor: pointer; color: #909399;" @click="selected.clear()"><Close /></el-icon>
          </div>
          <el-button size="small" plain :icon="Refresh" @click="loadUsers">刷新</el-button>
        </div>

        <!-- Table -->
        <div class="user-table-wrap">
          <table class="user-table" v-loading="loading">
            <thead>
              <tr>
                <th style="width: 40px;">
                  <input type="checkbox" :checked="allSelected" @change="toggleAll" />
                </th>
                <th style="width: 80px; cursor: pointer;" @click="toggleSort('uid')">
                  UID<span :class="sortIconClass('uid')">{{ sortArrow('uid') }}</span>
                </th>
                <th style="cursor: pointer; text-align: left;" @click="toggleSort('name')">
                  用户<span :class="sortIconClass('name')">{{ sortArrow('name') }}</span>
                </th>
                <th style="text-align: left;">角色</th>
                <th style="width: 110px;">状态</th>
                <th style="width: 100px; cursor: pointer;" @click="toggleSort('solved')">
                  AC<span :class="sortIconClass('solved')">{{ sortArrow('solved') }}</span>
                </th>
                <th style="width: 170px; cursor: pointer;" @click="toggleSort('lastLogin')">
                  最近登录<span :class="sortIconClass('lastLogin')">{{ sortArrow('lastLogin') }}</span>
                </th>
                <th style="width: 280px;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in userList" :key="u.uid" :class="{ 'row-selected': selected.has(u.uid) }">
                <td><input type="checkbox" :checked="selected.has(u.uid)" @change="toggleOne(u.uid)" /></td>
                <td class="mono uid-cell">#{{ u.uid }}</td>
                <td style="text-align: left;">
                  <div class="user-cell">
                    <div class="avatar" :style="avatarStyle(u)">{{ (u.name || '?')[0].toUpperCase() }}</div>
                    <div style="min-width: 0;">
                      <div class="user-name-row">
                        <router-link :to="'/user/' + u.uid" class="rlink user-name" :class="userNameClass(u)">{{ u.name }}</router-link>
                        <span v-if="u.grantCount > 0" class="grant-badge" :title="u.grantCount + ' 条直接授权'">
                          <el-icon :size="9"><Key /></el-icon>{{ u.grantCount }}
                        </span>
                      </div>
                      <div class="user-email">{{ u.email }}</div>
                    </div>
                  </div>
                </td>
                <td style="text-align: left;">
                  <span v-if="!u.roles || !u.roles.length" class="no-role">—</span>
                  <div v-else class="role-tags">
                    <span v-for="rk in u.roles" :key="rk" class="role-tag" :style="roleTagStyle(rk)">
                      <el-icon v-if="rk === 'super_admin'" :size="11"><Lock /></el-icon>
                      {{ roleName(rk) }}
                    </span>
                  </div>
                </td>
                <td>
                  <span class="status-pill" :class="u.inUse ? 'ok' : 'banned'">
                    <span class="status-dot" />
                    {{ u.inUse ? '正常' : '封禁' }}
                  </span>
                </td>
                <td class="mono" :style="{ fontWeight: 600, color: u.solved >= 200 ? '#19be6b' : '#606266' }">{{ u.solved || 0 }}</td>
                <td class="mono last-login">{{ u.lastLogin || '—' }}</td>
                <td>
                  <div class="action-buttons">
                    <el-button size="small" type="primary" plain :icon="EditPen" @click="openEdit(u)" v-if="$canAny('user.manage', 'user.role.admin')">编辑</el-button>
                    <el-button size="small" type="info" plain :icon="Key" @click="resetPassword(u)" v-if="$can('user.manage')">重置密码</el-button>
                    <el-button size="small" :type="u.inUse ? 'danger' : 'success'" plain @click="setBlock(u.uid, !u.inUse)" v-if="$can('user.manage')">
                      {{ u.inUse ? '封禁' : '解封' }}
                    </el-button>
                  </div>
                </td>
              </tr>
              <tr v-if="userList.length === 0 && !loading">
                <td colspan="8" class="empty-row">无匹配用户</td>
              </tr>
            </tbody>
          </table>

          <!-- Pagination -->
          <div class="table-footer">
            <div>共 <b>{{ total }}</b> 条 · 已选 <b class="primary">{{ selected.size }}</b> 条</div>
            <el-pagination
              v-model:current-page="currentPage"
              :page-size="pageSize"
              :total="total"
              layout="prev, pager, next"
              small
              @current-change="loadUsers"
            />
          </div>
        </div>
      </div>

      <!-- Role × Permission Matrix tab -->
      <div v-if="activeTab === 'matrix'">
        <div class="section-header">
          <div>
            <div class="section-title">角色 × 权限矩阵</div>
            <div class="section-subtitle">
              来自 <code>server/auth/permissions.js</code> · 内置角色不可修改
            </div>
          </div>
          <div class="section-actions">
            <el-button size="small" plain :icon="Refresh" @click="reloadAll">同步目录</el-button>
            <el-button size="small" type="primary" :icon="Plus" :disabled="!canAssignRoles" @click="openCreateRole">新建自定义角色</el-button>
          </div>
        </div>
        <div class="matrix-wrap">
          <table class="matrix-table">
            <thead>
              <tr>
                <th class="matrix-perm-header">权限 · {{ permissions.length }} 项</th>
                <th v-for="r in roles" :key="r.key" class="matrix-role-header" @mouseenter="hoveredRole = r.key" @mouseleave="hoveredRole = null"
                  :class="{ highlighted: hoveredRole === r.key }">
                  <div class="matrix-role-cell">
                    <span class="role-tag" :style="roleTagStyle(r.key)">
                      <el-icon v-if="r.key === 'super_admin'" :size="11"><Lock /></el-icon>
                      {{ r.name }}
                    </span>
                    <div class="matrix-count">{{ (r.permissions || []).length }}/{{ permissions.length }}</div>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <template v-for="g in permGroups" :key="g.group">
                <tr class="group-row">
                  <td :colspan="roles.length + 1" :style="{ background: groupColor(g.group) + '08', color: groupColor(g.group) }">
                    {{ groupLabel(g.group) }} · {{ g.group }} ({{ g.perms.length }})
                  </td>
                </tr>
                <tr v-for="p in g.perms" :key="p.key"
                  @mouseenter="hoveredPerm = p.key" @mouseleave="hoveredPerm = null"
                  :class="{ 'perm-row-hover': hoveredPerm === p.key }">
                  <td class="perm-key-cell">
                    <div class="perm-key-wrap">
                      <div>
                        <div class="perm-key-row">
                          <code>{{ p.key }}</code>
                          <span v-if="p.scopable" class="scoped-badge">SCOPED</span>
                        </div>
                        <div class="perm-name">{{ p.name }}</div>
                      </div>
                    </div>
                  </td>
                  <td v-for="r in roles" :key="r.key" class="matrix-cell"
                    :class="{
                      highlighted: hoveredRole === r.key || hoveredPerm === p.key,
                      'has-perm': (r.permissions || []).includes(p.key),
                    }">
                    <div v-if="(r.permissions || []).includes(p.key)" class="check-icon" :class="{ super: r.key === 'super_admin' }">
                      <el-icon :size="13"><Check /></el-icon>
                    </div>
                    <div v-else class="dot-icon">·</div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <div class="matrix-legend">
          <span class="legend-item"><span class="legend-check" /><el-icon :size="10"><Check /></el-icon> 已授予</span>
          <span class="legend-item"><span class="legend-check super" /><el-icon :size="10"><Check /></el-icon> 全部权限（super_admin）</span>
          <span class="legend-item"><span class="scoped-badge">SCOPED</span> 可绑定作用域</span>
        </div>
      </div>

      <!-- Roles management tab -->
      <div v-if="activeTab === 'roles'">
        <div class="section-header">
          <div class="section-subtitle">共 <b>{{ roles.length }}</b> 个角色 · 内置 {{ roles.filter(r => r.builtin).length }} · 自定义 {{ roles.filter(r => !r.builtin).length }}</div>
          <el-button size="small" type="primary" :icon="Plus" :disabled="!canAssignRoles" @click="openCreateRole">新建自定义角色</el-button>
        </div>
        <div class="roles-grid">
          <div v-for="r in roles" :key="r.key" class="role-card">
            <div class="role-card-header">
              <div>
                <div class="role-card-tags">
                  <span class="role-tag" :style="roleTagStyle(r.key)">
                    <el-icon v-if="r.key === 'super_admin'" :size="11"><Lock /></el-icon>
                    {{ r.name }}
                  </span>
                  <span v-if="r.builtin" class="builtin-badge">BUILTIN</span>
                </div>
                <code class="role-key-text">{{ r.key }}</code>
              </div>
              <div class="role-card-actions">
                <el-button size="small" plain :disabled="(r.builtin && !isRoot) || !canAssignRoles" :icon="EditPen" @click="openEditRole(r)">编辑</el-button>
                <el-button size="small" plain type="danger" :disabled="r.builtin || !canAssignRoles" :icon="Delete" @click="deleteRole(r)">删除</el-button>
              </div>
            </div>
            <div class="role-desc">{{ r.description }}</div>
            <div class="role-perm-count">权限 {{ (r.permissions || []).length }}/{{ permissions.length }}</div>
            <div class="role-progress-bar">
              <div class="role-progress-fill" :style="{ width: (100 * (r.permissions || []).length / Math.max(permissions.length, 1)) + '%', background: r.key === 'super_admin' ? '#0E1D69' : roleColor(r.key) }" />
            </div>
            <div class="role-group-tags">
              <template v-for="g in ['problem','contest','judge','user','system']" :key="g">
                <span v-if="roleGroupCount(r, g) > 0" class="group-mini-tag" :style="{ background: groupColor(g) + '15', color: groupColor(g) }">
                  {{ groupLabel(g) }} {{ roleGroupCount(r, g) }}/{{ permGroupCount(g) }}
                </span>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- Permission catalog tab -->
      <div v-if="activeTab === 'catalog'">
        <div class="toolbar" style="margin-bottom: 10px;">
          <div class="search-box" style="flex: 0 0 320px;">
            <el-icon class="search-icon"><Search /></el-icon>
            <input v-model="catalogFilter" placeholder="按 key 或名称搜索" class="search-input" />
          </div>
          <div class="catalog-summary">
            共 <b>{{ permissions.length }}</b> 项 · <b style="color: #19be6b;">{{ permissions.filter(p => p.scopable).length }}</b> 项可作用域
          </div>
        </div>
        <template v-for="g in permGroupsFiltered" :key="g.group">
          <div class="catalog-group" v-if="g.perms.length">
            <div class="catalog-group-header" :style="{ background: groupColor(g.group) + '08' }">
              <span class="group-tag" :style="{ background: groupColor(g.group) + '15', color: groupColor(g.group) }">{{ groupLabel(g.group) }}</span>
              <span class="catalog-group-name">{{ groupLabel(g.group) }}</span>
              <span class="catalog-group-count">{{ g.perms.length }} keys</span>
            </div>
            <table class="catalog-table">
              <tbody>
                <tr v-for="p in g.perms" :key="p.key">
                  <td style="width: 280px;"><code>{{ p.key }}</code></td>
                  <td style="width: 160px; font-weight: 600;">{{ p.name }}</td>
                  <td style="color: #909399;">{{ p.description || '—' }}</td>
                  <td style="width: 90px; text-align: right;">
                    <span v-if="p.scopable" class="scoped-badge">SCOPED</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>

      <!-- Audit log tab -->
      <div v-if="activeTab === 'audit'">
        <div class="section-header">
          <div>
            <div class="section-title">审计日志</div>
            <div class="section-subtitle">权限敏感操作的完整轨迹 · 需要 <code>audit.view</code></div>
          </div>
          <div class="section-actions">
            <el-button size="small" plain :icon="Refresh" @click="loadAuditLog">刷新</el-button>
          </div>
        </div>
        <div class="user-table-wrap">
          <table class="user-table" v-loading="auditLoading">
            <thead>
              <tr>
                <th style="width: 160px; text-align: left;">时间</th>
                <th style="width: 80px;">类型</th>
                <th style="width: 120px; text-align: left;">操作者</th>
                <th style="text-align: left;">事件</th>
                <th style="text-align: left;">详情</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(e, i) in auditList" :key="i">
                <td class="mono" style="font-size: 12px; color: #909399; text-align: left; padding: 10px 14px;">{{ e.time }}</td>
                <td style="text-align: center;">
                  <span class="audit-kind-tag" :style="auditKindStyle(e.eventKey)">{{ auditKindLabel(e.eventKey) }}</span>
                </td>
                <td style="text-align: left; padding: 10px 14px;">
                  <span v-if="e.actorName" style="color: #9c27b0; font-weight: 600;">{{ e.actorName }}</span>
                  <span v-else style="color: #c0c4cc;">—</span>
                </td>
                <td style="text-align: left; padding: 10px 14px;">
                  <code style="color: #409EFF; font-weight: 600;">{{ e.eventKey }}</code>
                  <span style="color: #909399; margin: 0 6px;">→</span>
                  <span>{{ e.eventName }}</span>
                </td>
                <td style="text-align: left; padding: 10px 14px; font-size: 12px; color: #606266;">
                  {{ typeof e.detail === 'object' ? JSON.stringify(e.detail) : (e.detail || '—') }}
                </td>
              </tr>
              <tr v-if="auditList.length === 0 && !auditLoading">
                <td colspan="5" class="empty-row">暂无审计记录</td>
              </tr>
            </tbody>
          </table>
          <div class="table-footer" v-if="auditTotal > 30">
            <div>共 <b>{{ auditTotal }}</b> 条</div>
            <el-pagination
              v-model:current-page="auditPage"
              :page-size="30"
              :total="auditTotal"
              layout="prev, pager, next"
              small
              @current-change="loadAuditLog"
            />
          </div>
        </div>
      </div>
    </main>

    <!-- Edit user drawer -->
    <el-drawer v-model="editDrawerVisible" :title="null" direction="rtl" size="800px" :with-header="false" :close-on-click-modal="true">
      <template v-if="editingUser">
        <!-- Drawer header -->
        <div class="drawer-header">
          <div class="avatar" :style="avatarStyle(editingUser)" style="width: 42px; height: 42px; font-size: 19px;">{{ (editingUser.name || '?')[0].toUpperCase() }}</div>
          <div style="flex: 1; min-width: 0;">
            <div class="drawer-user-title">
              <span class="drawer-user-name">{{ editingUser.name }}</span>
              <span class="mono" style="font-size: 12px; color: #909399;">uid={{ editingUser.uid }}</span>
              <span class="status-pill" :class="editingUser.inUse ? 'ok' : 'banned'">
                <span class="status-dot" />&nbsp;{{ editingUser.inUse ? '正常' : '封禁' }}
              </span>
            </div>
            <div style="font-size: 12px; color: #909399; margin-top: 2px;">{{ editingUser.email }} · 注册 {{ editingUser.regDate }}</div>
          </div>
        </div>

        <!-- Drawer tabs -->
        <el-tabs v-model="editTab" class="drawer-tabs">
          <el-tab-pane label="基础资料" name="profile" />
          <el-tab-pane name="roles">
            <template #label>角色</template>
          </el-tab-pane>
          <el-tab-pane name="grants">
            <template #label>
              直接授权
              <el-badge v-if="editGrants.length" :value="editGrants.length" class="tab-badge" />
            </template>
          </el-tab-pane>
          <el-tab-pane name="effective">
            <template #label>有效权限</template>
          </el-tab-pane>
          <el-tab-pane label="登录日志" name="log" />
        </el-tabs>

        <!-- Tab content -->
        <div class="drawer-body">
          <!-- Profile -->
          <div v-if="editTab === 'profile'">
            <div class="field-row">
              <label>用户名</label>
              <el-input v-model="editForm.name" :disabled="!$can('user.manage')" />
            </div>
            <div class="field-row">
              <label>邮箱</label>
              <el-input v-model="editForm.email" :disabled="!$can('user.manage')" />
            </div>
            <div class="field-row">
              <label>注册时间</label>
              <span class="readonly-val">{{ editingUser.regDate }}</span>
            </div>
            <div class="field-row">
              <label>最近登录</label>
              <span class="readonly-val">{{ editingUser.lastLogin || '—' }}</span>
            </div>
            <div class="field-row">
              <label>个性签名</label>
              <span class="readonly-val" :style="{ color: editingUser.motto ? '#3f3f3f' : '#c0c4cc' }">{{ editingUser.motto || '（未填）' }}</span>
            </div>
            <div class="danger-zone">
              <div class="danger-title">危险操作</div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <el-button size="small" plain type="warning" :icon="Key" @click="resetPassword(editingUser)" v-if="$can('user.manage')">重置密码</el-button>
                <el-button size="small" plain :type="editingUser.inUse ? 'danger' : 'success'" @click="setBlock(editingUser.uid, !editingUser.inUse)" v-if="$can('user.manage')">
                  {{ editingUser.inUse ? '封禁账号' : '解除封禁' }}
                </el-button>
              </div>
            </div>
          </div>

          <!-- Roles -->
          <div v-if="editTab === 'roles'">
            <div class="hint-box">
              通过 <code>POST /api/auth/setUserRoles</code> 设置。一个用户可拥有多个角色，最终权限取并集。
            </div>
            <el-checkbox-group v-model="editRoleKeys" class="role-checklist">
              <label v-for="r in roles" :key="r.key" class="role-check-item" :class="{ checked: editRoleKeys.includes(r.key) }">
                <el-checkbox :label="r.key" :disabled="!canAssignRoles" />
                <div style="flex: 1; min-width: 0; margin-left: 8px;">
                  <div class="role-check-header">
                    <span class="role-tag" :style="roleTagStyle(r.key)">
                      <el-icon v-if="r.key === 'super_admin'" :size="11"><Lock /></el-icon>
                      {{ r.name }}
                    </span>
                    <code class="role-key-inline">{{ r.key }}</code>
                  </div>
                  <div class="role-check-desc">{{ r.description }}</div>
                  <div class="role-check-count">{{ (r.permissions || []).length }} 项权限</div>
                </div>
              </label>
            </el-checkbox-group>
          </div>

          <!-- Direct grants -->
          <div v-if="editTab === 'grants'">
            <div class="hint-box">
              单点授权（user_permissions 表）。<code>deny</code> 优先于 allow；scope 为空表示全局。需要 <code>user.role.admin</code>。
            </div>
            <GrantTable
              v-if="canGrantPerm"
              :uid="editingUser.uid"
              :grants="editGrants"
              :permissions="permissions"
              @changed="refreshEditGrants"
            />
            <div v-else class="empty-grants">需要 user.role.admin 权限以管理直接授权。</div>
          </div>

          <!-- Effective permissions -->
          <div v-if="editTab === 'effective'">
            <div class="mini-stats">
              <div class="mini-stat" style="background: #19be6b0d; border-color: #19be6b33;">
                <div class="mini-stat-val" style="color: #19be6b;">{{ effectiveGlobal.size }}</div>
                <div class="mini-stat-label">全局权限</div>
              </div>
              <div class="mini-stat" style="background: #9c27b00d; border-color: #9c27b033;">
                <div class="mini-stat-val" style="color: #9c27b0;">{{ effectiveScoped.size }}</div>
                <div class="mini-stat-label">作用域权限</div>
              </div>
              <div class="mini-stat" style="background: #ed40140d; border-color: #ed401433;">
                <div class="mini-stat-val" style="color: #ed4014;">{{ effectiveDenies.size }}</div>
                <div class="mini-stat-label">拒绝项 (deny)</div>
              </div>
            </div>
            <div v-for="g in ['problem','contest','judge','user','system']" :key="g" style="margin-bottom: 14px;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <span class="group-tag" :style="{ background: groupColor(g) + '15', color: groupColor(g) }">{{ groupLabel(g) }}</span>
                <span style="font-size: 12px; color: #909399;">
                  {{ permissionsOfGroup(g).filter(p => effectiveGlobal.has(p.key) && !effectiveDenies.has(p.key)).length }}/{{ permissionsOfGroup(g).length }}
                </span>
              </div>
              <div class="effective-grid">
                <div v-for="p in permissionsOfGroup(g)" :key="p.key" class="effective-item" :class="{
                  denied: effectiveDenies.has(p.key),
                  allowed: effectiveGlobal.has(p.key) && !effectiveDenies.has(p.key),
                }">
                  <span class="effective-indicator" :class="{
                    denied: effectiveDenies.has(p.key),
                    allowed: effectiveGlobal.has(p.key) && !effectiveDenies.has(p.key),
                  }">
                    <el-icon :size="10" v-if="effectiveDenies.has(p.key)"><Close /></el-icon>
                    <el-icon :size="10" v-else-if="effectiveGlobal.has(p.key)"><Check /></el-icon>
                  </span>
                  <code>{{ p.key }}</code>
                  <span v-if="effectiveScoped.has(p.key)" class="scoped-badge" style="font-size: 9px;">SCOPED</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Login log -->
          <div v-if="editTab === 'log'">
            <div style="font-size: 12px; color: #909399; margin-bottom: 12px;">最近登录记录</div>
            <table class="user-table" v-loading="loginLogLoading" style="font-size: 12px;">
              <thead>
                <tr>
                  <th style="text-align: left;">时间</th>
                  <th style="text-align: left;">IP</th>
                  <th style="text-align: left;">属地</th>
                  <th style="text-align: left;">浏览器</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(l, i) in loginLog" :key="i">
                  <td class="mono" style="text-align: left; color: #606266;">{{ l.time }}</td>
                  <td class="mono" style="text-align: left;">{{ l.loginIp }}</td>
                  <td style="text-align: left;">{{ l.loginLoc }}</td>
                  <td style="text-align: left; color: #909399;">{{ l.browser }} / {{ l.os }}</td>
                </tr>
                <tr v-if="loginLog.length === 0 && !loginLogLoading">
                  <td colspan="4" class="empty-row">暂无记录</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Drawer footer -->
        <div class="drawer-footer">
          <div style="font-size: 12px; color: #909399;">
            <span v-if="editDirty" style="color: #ff9900; font-weight: 600;">● 已修改未保存</span>
            <span v-else>无未保存改动</span>
          </div>
          <div style="display: flex; gap: 8px;">
            <el-button @click="editDrawerVisible = false">取消</el-button>
            <el-button type="primary" :disabled="!editDirty" :loading="saving" @click="saveEdit">保存</el-button>
          </div>
        </div>
      </template>
    </el-drawer>

    <!-- Role editor dialog -->
    <RoleEditor
      v-model="roleEditorVisible"
      :role="editingRole"
      :permissions="permissions"
      @saved="onRoleSaved"
    />
  </div>
</template>

<script>
import axios from 'axios';
import { ElMessageBox, ElMessage } from 'element-plus';
import { Search, Refresh, Plus, EditPen, Delete, Key, Lock, Check, Close } from '@element-plus/icons-vue';
import { markRaw } from 'vue';
import UserPicker from '@/components/permission/UserPicker.vue';
import GrantTable from '@/components/permission/GrantTable.vue';
import RoleEditor from '@/components/permission/RoleEditor.vue';
import { can } from '@/utils/can';

const ROLE_COLORS = {
  user:            { bg: '#f0f2f5', fg: '#606266', border: '#dcdfe6' },
  problem_setter:  { bg: '#ecf5ff', fg: '#2d8cf0', border: '#b3d8ff' },
  contest_manager: { bg: '#f5edff', fg: '#9c27b0', border: '#dcc6f0' },
  judge_admin:     { bg: '#fff7e6', fg: '#d97706', border: '#ffd591' },
  moderator:       { bg: '#fff0e6', fg: '#d4380d', border: '#ffbb96' },
  super_admin:     { bg: '#0E1D69', fg: '#ffffff', border: '#0E1D69' },
};
const GROUP_LABELS = { problem: '题目', contest: '比赛', judge: '判题', user: '用户', system: '系统' };
const GROUP_COLORS = { problem: '#2d8cf0', contest: '#9c27b0', judge: '#ff9900', user: '#19be6b', system: '#626aef' };

const AUDIT_KIND_MAP = {
  'auth.setUserRoles': { color: '#9c27b0', label: 'ROLE' },
  'auth.grantUserPermission': { color: '#ff9900', label: 'GRANT' },
  'auth.revokeUserPermission': { color: '#ff9900', label: 'GRANT' },
  'auth.createRole': { color: '#9c27b0', label: 'ROLE' },
  'auth.updateRole': { color: '#9c27b0', label: 'ROLE' },
  'auth.deleteRole': { color: '#9c27b0', label: 'ROLE' },
  'user.login': { color: '#607D8B', label: 'AUTH' },
  'user.loginFail.wrongPassword': { color: '#ed4014', label: 'AUTH' },
  'user.loginFail.userBlocked': { color: '#ed4014', label: 'BAN' },
  'user.logout': { color: '#607D8B', label: 'AUTH' },
  'user.updateProfile': { color: '#409EFF', label: 'EDIT' },
  'auth.changePassword': { color: '#409EFF', label: 'AUTH' },
  'auth.changeEmail': { color: '#409EFF', label: 'EDIT' },
};

export default {
  name: 'PermissionCenter',
  components: { UserPicker, GrantTable, RoleEditor, Search, Refresh, Plus, EditPen, Delete, Key, Lock, Check, Close },
  data() {
    return {
      activeTab: 'users',
      loading: false,
      permissions: [],
      roles: [],
      // users tab
      userList: [],
      total: 0,
      currentPage: 1,
      pageSize: 10,
      filter: { q: '', roleKey: '', inUse: '' },
      sort: { key: 'uid', dir: 'asc' },
      selected: new Set(),
      stats: null,
      // matrix
      hoveredRole: null,
      hoveredPerm: null,
      // catalog
      catalogFilter: '',
      // audit
      auditList: [],
      auditTotal: 0,
      auditPage: 1,
      auditLoading: false,
      // edit drawer
      editDrawerVisible: false,
      editingUser: null,
      editTab: 'profile',
      editForm: { name: '', email: '' },
      editRoleKeys: [],
      originalRoleKeys: [],
      editGrants: [],
      loginLog: [],
      loginLogLoading: false,
      saving: false,
      // role editor
      roleEditorVisible: false,
      editingRole: null,
      // icons
      Search: markRaw(Search),
      Refresh: markRaw(Refresh),
      Plus: markRaw(Plus),
      EditPen: markRaw(EditPen),
      Delete: markRaw(Delete),
      Key: markRaw(Key),
    };
  },
  computed: {
    canAssignRoles() { return can('user.role.admin'); },
    canGrantPerm() { return can('user.role.admin'); },
    isRoot() { return this.$store.state.isRoot; },
    sidebarItems() {
      return [
        { id: 'users', label: '用户列表', icon: 'User', badge: this.total || null },
        { id: 'matrix', label: '角色权限矩阵', icon: 'Grid', badge: this.roles.length || null },
        { id: 'roles', label: '角色管理', icon: 'Lock' },
        { id: 'catalog', label: '权限目录', icon: 'Document', badge: this.permissions.length || null },
        { id: 'audit', label: '审计日志', icon: 'List' },
      ];
    },
    statItems() {
      if (!this.stats) return [];
      return [
        { label: '总用户数', value: this.stats.totalUsers, color: '#409EFF', icon: 'User' },
        { label: '有角色', value: this.stats.withRoles, color: '#9c27b0', icon: 'Lock' },
        { label: '已封禁', value: this.stats.banned, color: '#ed4014', icon: 'Warning' },
        { label: '直接授权数', value: this.stats.grantCount, color: '#ff9900', icon: 'Key' },
      ];
    },
    allSelected() {
      return this.userList.length > 0 && this.userList.every(u => this.selected.has(u.uid));
    },
    permGroups() {
      const groups = ['problem', 'contest', 'judge', 'user', 'system'];
      return groups.map(g => ({ group: g, perms: this.permissions.filter(p => p.group === g) }));
    },
    permGroupsFiltered() {
      const q = this.catalogFilter.trim().toLowerCase();
      return this.permGroups.map(g => ({
        group: g.group,
        perms: q ? g.perms.filter(p => p.key.includes(q) || p.name.includes(q)) : g.perms,
      }));
    },
    editDirty() {
      if (!this.editingUser) return false;
      if (this.editForm.name !== this.editingUser.name) return true;
      if (this.editForm.email !== this.editingUser.email) return true;
      const a = [...this.editRoleKeys].sort();
      const b = [...this.originalRoleKeys].sort();
      if (a.length !== b.length) return true;
      return a.some((k, i) => k !== b[i]);
    },
    effectiveGlobal() {
      const s = new Set();
      for (const rk of this.editRoleKeys) {
        const r = this.roles.find(x => x.key === rk);
        if (r) (r.permissions || []).forEach(p => s.add(p));
      }
      for (const g of this.editGrants) {
        if (g.expiresAt && new Date(g.expiresAt) < new Date()) continue;
        if (g.effect === 'deny') continue;
        if (!g.resourceType) s.add(g.permissionKey);
      }
      return s;
    },
    effectiveDenies() {
      const s = new Set();
      for (const g of this.editGrants) {
        if (g.expiresAt && new Date(g.expiresAt) < new Date()) continue;
        if (g.effect === 'deny') s.add(g.permissionKey);
      }
      return s;
    },
    effectiveScoped() {
      const m = new Map();
      for (const g of this.editGrants) {
        if (g.expiresAt && new Date(g.expiresAt) < new Date()) continue;
        if (g.effect === 'deny') continue;
        if (g.resourceType && g.resourceId != null) {
          if (!m.has(g.permissionKey)) m.set(g.permissionKey, new Set());
          m.get(g.permissionKey).add(`${g.resourceType}:${g.resourceId}`);
        }
      }
      return m;
    },
  },
  watch: {
    activeTab(tab) {
      if (tab === 'audit' && this.auditList.length === 0) this.loadAuditLog();
    },
    editTab(tab) {
      if (tab === 'log' && this.loginLog.length === 0) this.loadLoginLog();
    },
  },
  async mounted() {
    const q = this.$route.query || {};
    if (q.tab) this.activeTab = q.tab;
    await this.reloadAll();
    this.loadUsers();
    this.loadStats();
    if (q.uid) {
      const uid = parseInt(q.uid, 10);
      const u = this.userList.find(x => x.uid === uid);
      if (u) this.openEdit(u);
    }
  },
  methods: {
    async reloadAll() {
      try {
        const [pr, rr] = await Promise.all([
          axios.post('/api/auth/listPermissions'),
          axios.post('/api/auth/listRoles'),
        ]);
        this.permissions = (pr.data && pr.data.permissions) || [];
        this.roles = (rr.data && rr.data.roles) || [];
      } catch (e) {
        ElMessage.error(e.message || '加载失败');
      }
    },
    async loadStats() {
      try {
        const res = await axios.post('/api/admin/getAdminStats');
        if (res.status === 200) this.stats = res.data;
      } catch (_e) { /* silent */ }
    },
    async loadUsers() {
      this.loading = true;
      try {
        const filter = {};
        const q = this.filter.q.trim();
        // Backend handles unified search across uid/name/email so the user
        // doesn't have to know which field they're typing into.
        if (q) filter.q = q;
        if (this.filter.roleKey) filter.roleKey = this.filter.roleKey;
        if (this.filter.inUse !== '' && this.filter.inUse != null) filter.inUse = this.filter.inUse;

        const res = await axios.post('/api/admin/getUserInfoList', {
          pageId: this.currentPage,
          pageSize: this.pageSize,
          filter,
          sort: this.sort,
        });
        if (res.status === 200) {
          this.total = res.data.total;
          this.userList = res.data.userList;
        }
      } catch (e) {
        ElMessage.error(e.message || '加载失败');
      } finally {
        this.loading = false;
      }
    },
    // Filter changes should reset to page 1 — otherwise the user can land
    // on an empty page (e.g. on page 5 of unfiltered results, then filter
    // down to 8 rows ⇒ page 5 is empty).
    onFilterChange() {
      this.currentPage = 1;
      this.loadUsers();
    },
    // Debounce live search to avoid spamming the server on every keystroke.
    onSearchInput() {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this.onFilterChange(), 300);
    },
    toggleSort(key) {
      if (this.sort.key === key) {
        this.sort.dir = this.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        this.sort = { key, dir: 'asc' };
      }
      this.loadUsers();
    },
    sortArrow(key) {
      if (this.sort.key !== key) return '↕';
      return this.sort.dir === 'asc' ? '↑' : '↓';
    },
    sortIconClass(key) {
      return this.sort.key === key ? 'sort-icon active' : 'sort-icon';
    },
    toggleAll() {
      if (this.allSelected) {
        this.userList.forEach(u => this.selected.delete(u.uid));
      } else {
        this.userList.forEach(u => this.selected.add(u.uid));
      }
    },
    toggleOne(uid) {
      if (this.selected.has(uid)) this.selected.delete(uid);
      else this.selected.add(uid);
    },
    roleName(key) {
      const r = this.roles.find(x => x.key === key);
      return r ? r.name : key;
    },
    roleTagStyle(key) {
      const c = ROLE_COLORS[key] || { bg: '#f5f7fa', fg: '#606266', border: '#dcdfe6' };
      return { background: c.bg, color: c.fg, borderColor: c.border };
    },
    roleColor(key) {
      return (ROLE_COLORS[key] || {}).fg || '#409EFF';
    },
    groupColor(g) { return GROUP_COLORS[g] || '#909399'; },
    groupLabel(g) { return GROUP_LABELS[g] || g; },
    avatarStyle(u) {
      const hue = (u.uid * 47) % 360;
      return {
        background: `hsl(${hue}, 40%, 90%)`,
        color: `hsl(${hue}, 60%, 35%)`,
      };
    },
    userNameClass(u) {
      if ((u.roles || []).includes('super_admin')) return 'name-super';
      if ((u.roles || []).length) return 'name-staff';
      return '';
    },
    permissionsOfGroup(g) {
      return this.permissions.filter(p => p.group === g);
    },
    roleGroupCount(role, group) {
      const groupPerms = this.permissions.filter(p => p.group === group);
      return (role.permissions || []).filter(k => groupPerms.find(p => p.key === k)).length;
    },
    permGroupCount(group) {
      return this.permissions.filter(p => p.group === group).length;
    },

    // ---- Edit user ----
    async openEdit(u) {
      this.editingUser = { ...u };
      this.editForm = { name: u.name, email: u.email };
      // Default tab follows what the caller can actually do: role admins land
      // on the role/grant flow, plain user-managers land on profile/ban.
      this.editTab = this.canAssignRoles ? 'roles' : 'profile';
      this.editRoleKeys = [...(u.roles || [])];
      this.originalRoleKeys = [...(u.roles || [])];
      this.editGrants = [];
      this.loginLog = [];
      this.editDrawerVisible = true;
      this.refreshEditGrants();
    },
    async refreshEditGrants() {
      if (!this.editingUser) return;
      try {
        const res = await axios.post('/api/auth/listUserGrants', { uid: this.editingUser.uid });
        if (res.status === 200) {
          this.editRoleKeys = res.data.roles || [];
          this.originalRoleKeys = [...this.editRoleKeys];
          this.editGrants = res.data.permissions || [];
        }
      } catch (_e) { /* silent */ }
    },
    async loadLoginLog() {
      if (!this.editingUser) return;
      this.loginLogLoading = true;
      try {
        const res = await axios.post('/api/admin/getUserLoginLog', { uid: this.editingUser.uid });
        if (res.status === 200) this.loginLog = res.data.list || [];
      } catch (_e) { /* silent */ }
      this.loginLogLoading = false;
    },
    async saveEdit() {
      this.saving = true;
      try {
        const promises = [];
        if (this.editForm.name !== this.editingUser.name || this.editForm.email !== this.editingUser.email) {
          promises.push(axios.post('/api/admin/updateUserInfo', {
            info: { uid: this.editingUser.uid, name: this.editForm.name, email: this.editForm.email },
          }));
        }
        const a = [...this.editRoleKeys].sort();
        const b = [...this.originalRoleKeys].sort();
        const rolesDirty = a.length !== b.length || a.some((k, i) => k !== b[i]);
        if (rolesDirty) {
          promises.push(axios.post('/api/auth/setUserRoles', {
            uid: this.editingUser.uid,
            roleKeys: this.editRoleKeys,
          }));
        }
        await Promise.all(promises);
        ElMessage.success('已保存');
        this.editingUser.name = this.editForm.name;
        this.editingUser.email = this.editForm.email;
        this.editingUser.roles = [...this.editRoleKeys];
        this.originalRoleKeys = [...this.editRoleKeys];
        this.loadUsers();
      } catch (e) {
        ElMessage.error(e.message || '保存失败');
      } finally {
        this.saving = false;
      }
    },

    // ---- Actions ----
    async setBlock(uid, newInUse) {
      const status = newInUse ? 1 : 0;
      try {
        await axios.post('/api/admin/setBlock', { uid, status });
        ElMessage.success('操作成功');
        this.loadUsers();
        if (this.editingUser && this.editingUser.uid === uid) {
          this.editingUser.inUse = status;
        }
      } catch (e) {
        ElMessage.error(e.message || '操作失败');
      }
    },
    async resetPassword(u) {
      try {
        await ElMessageBox.confirm(`确认重置 ${u.name} 的密码？`, '重置密码', { type: 'warning' });
      } catch (_) { return; }
      try {
        const res = await axios.post('/api/admin/resetPassword', { uid: u.uid });
        if (res.status === 200 && res.data.newPassword) {
          ElMessageBox.alert(`新密码: ${res.data.newPassword}`, '密码已重置', { type: 'success' });
        }
      } catch (e) {
        ElMessage.error(e.message || '重置失败');
      }
    },
    batchChangeRole() { ElMessage.info('批量修改角色 — 待实现'); },
    batchBan() { ElMessage.info('批量封禁 — 待实现'); },

    // ---- Role management ----
    openCreateRole() { this.editingRole = null; this.roleEditorVisible = true; },
    openEditRole(role) { this.editingRole = role; this.roleEditorVisible = true; },
    async onRoleSaved() { await this.reloadAll(); },
    async deleteRole(role) {
      try {
        await ElMessageBox.confirm(`确认删除自定义角色 ${role.key}？`, '提示', { type: 'warning' });
      } catch (_) { return; }
      try {
        const res = await axios.post('/api/auth/deleteRole', { key: role.key });
        if (res.status === 200) { ElMessage.success('已删除'); await this.reloadAll(); }
        else ElMessage.error(res.data?.message || '删除失败');
      } catch (e) {
        ElMessage.error(e.message || '删除失败');
      }
    },

    // ---- Audit log ----
    async loadAuditLog() {
      this.auditLoading = true;
      try {
        const res = await axios.post('/api/admin/listAuditLog', { pageId: this.auditPage });
        if (res.status === 200) {
          this.auditList = res.data.list || [];
          this.auditTotal = res.data.total || 0;
        }
      } catch (e) {
        ElMessage.error(e.message || '加载失败');
      } finally {
        this.auditLoading = false;
      }
    },
    auditKindStyle(eventKey) {
      const k = AUDIT_KIND_MAP[eventKey] || { color: '#909399', label: 'SYS' };
      return { background: k.color + '15', color: k.color };
    },
    auditKindLabel(eventKey) {
      return (AUDIT_KIND_MAP[eventKey] || { label: 'SYS' }).label;
    },
  },
};
</script>

<style scoped>
.perm-page {
  display: flex;
  align-items: stretch;
  background: #f0f2f5;
  min-height: calc(100vh - 60px);
}

/* Sidebar */
.perm-sidebar {
  width: 220px;
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid #ebeef5;
  padding: 18px 0;
}
.sidebar-header { padding: 0 18px 14px 18px; }
.sidebar-label {
  font-size: 11px;
  color: #909399;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  font-weight: 700;
  margin-bottom: 4px;
  font-family: 'Courier New', monospace;
}
.sidebar-title { font-size: 18px; font-weight: 800; color: #3f3f3f; }
.sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  border-left: 3px solid transparent;
  cursor: pointer;
  user-select: none;
  transition: all 0.15s;
}
.sidebar-item:hover { background: #f5f7fa; }
.sidebar-item.active {
  color: #409EFF;
  font-weight: 600;
  background: linear-gradient(90deg, rgba(64,158,255,0.08), rgba(64,158,255,0));
  border-left-color: #409EFF;
}
.sidebar-item .el-icon { color: #909399; }
.sidebar-item.active .el-icon { color: #409EFF; }
.sidebar-item-label { flex: 1; }
.sidebar-badge {
  font-size: 11px;
  font-family: 'Courier New', monospace;
  color: #909399;
  background: #f5f7fa;
  padding: 1px 7px;
  border-radius: 10px;
  font-weight: 600;
  min-width: 22px;
  text-align: center;
}
.sidebar-badge.active { color: #409EFF; background: #ecf5ff; }
.sidebar-footer {
  margin: 20px 18px;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 11px;
  color: #909399;
  line-height: 1.6;
  font-family: 'Courier New', monospace;
}
.sidebar-footer-title { color: #3f3f3f; font-weight: 700; margin-bottom: 4px; }

/* Main */
.perm-main { flex: 1; padding: 16px; min-width: 0; }

/* Stat strip */
.stat-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 10px;
}
.stat-item {
  padding: 14px 18px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.stat-icon {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.stat-value { font-size: 22px; font-weight: 800; color: #3f3f3f; line-height: 1.1; letter-spacing: -0.3px; }
.stat-label-text { font-size: 12px; color: #909399; margin-top: 3px; }

/* Toolbar */
.toolbar {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 12px 16px;
  margin-bottom: 10px;
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.search-box { position: relative; flex: 0 0 280px; }
.search-icon { position: absolute; left: 10px; top: 8px; color: #c0c4cc; }
.search-input {
  width: 100%;
  padding: 6px 10px 6px 30px;
  font-size: 13px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  outline: none;
  font-family: inherit;
}
.search-input:focus { border-color: #409EFF; }
.batch-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: #ecf5ff;
  border: 1px solid #b3d8ff;
  border-radius: 4px;
  font-size: 12px;
  color: #409EFF;
  font-weight: 600;
}

/* User table */
.user-table-wrap {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
}
.user-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.user-table thead th {
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #909399;
  text-align: center;
  border-bottom: 1px solid #ebeef5;
  white-space: nowrap;
  background: #fafbfc;
}
.user-table tbody td {
  padding: 12px;
  text-align: center;
  vertical-align: middle;
  border-top: 1px solid #f2f4f7;
}
.row-selected { background: #f5fbff !important; }
.mono { font-family: 'Courier New', monospace; }
.uid-cell { color: #909399; font-size: 12px; }
.user-cell { display: flex; align-items: center; gap: 10px; }
.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  flex-shrink: 0;
}
.user-name-row { display: flex; align-items: center; gap: 6px; }
.user-name { font-weight: 500; }
.user-name.name-super { color: #0E1D69; font-weight: 700; }
.user-name.name-staff { color: #8e44ad; font-weight: 700; }
.user-email { font-size: 11px; color: #909399; margin-top: 1px; }
.grant-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: #ff9900;
  background: #fff7e6;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 700;
  font-family: 'Courier New', monospace;
}
.no-role { color: #c0c4cc; font-size: 12px; }
.role-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.role-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid;
  border-radius: 4px;
  line-height: 1.4;
  white-space: nowrap;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
}
.status-pill.ok { color: #19be6b; }
.status-pill.banned { color: #ed4014; }
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}
.status-pill.ok .status-dot { background: #19be6b; box-shadow: 0 0 0 3px rgba(25,190,107,0.18); }
.status-pill.banned .status-dot { background: #ed4014; box-shadow: 0 0 0 3px rgba(237,64,20,0.18); }
.last-login { font-size: 12px; color: #909399; }
.action-buttons { display: flex; justify-content: center; gap: 6px; }
.empty-row { padding: 60px; text-align: center; color: #909399; font-size: 13px; }
.table-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid #f2f4f7;
  font-size: 12px;
  color: #909399;
}
.table-footer b { color: #3f3f3f; font-weight: 700; }
.table-footer b.primary { color: #409EFF; }
.sort-icon { color: #c0c4cc; margin-left: 3px; }
.sort-icon.active { color: #409EFF; }

/* Section headers */
.section-header {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 14px 18px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.section-title { font-size: 16px; font-weight: 800; color: #3f3f3f; }
.section-subtitle { font-size: 12px; color: #909399; margin-top: 4px; }
.section-subtitle code {
  background: #f5f7fa;
  padding: 1px 5px;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
  color: #9c27b0;
}
.section-actions { display: flex; gap: 8px; }

/* Matrix */
.matrix-wrap {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: auto;
}
.matrix-table { border-collapse: collapse; width: 100%; min-width: 980px; }
.matrix-perm-header {
  padding: 14px 14px;
  text-align: left;
  border-bottom: 2px solid #ebeef5;
  font-size: 12px;
  font-weight: 600;
  color: #909399;
  position: sticky;
  left: 0;
  background: #fafbfc;
  z-index: 2;
  width: 280px;
}
.matrix-role-header {
  padding: 12px 8px;
  border-bottom: 2px solid #ebeef5;
  text-align: center;
  background: #fafbfc;
  min-width: 110px;
  transition: background 0.15s;
}
.matrix-role-header.highlighted { background: #f5fbff; }
.matrix-role-cell { display: flex; flex-direction: column; align-items: center; gap: 5px; }
.matrix-count { font-size: 11px; color: #909399; font-weight: 600; }
.group-row td {
  padding: 8px 14px;
  border-bottom: 1px solid #ebeef5;
  border-top: 1px solid #ebeef5;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  font-family: 'Courier New', monospace;
  position: sticky;
  left: 0;
}
.perm-row-hover { background: #fafbfc; }
.perm-key-cell {
  padding: 11px 14px;
  border-bottom: 1px solid #f2f4f7;
  position: sticky;
  left: 0;
  background: inherit;
  z-index: 1;
  text-align: left;
}
.perm-key-wrap { display: flex; align-items: flex-start; gap: 8px; }
.perm-key-row { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.perm-key-row code { font-size: 12px; color: #3f3f3f; font-weight: 600; font-family: 'Courier New', monospace; }
.perm-name { font-size: 12px; color: #606266; }
.scoped-badge {
  font-size: 9px;
  color: #19be6b;
  background: #f0f9eb;
  padding: 1px 4px;
  border-radius: 2px;
  font-weight: 700;
  font-family: 'Courier New', monospace;
}
.matrix-cell {
  padding: 8px 8px;
  text-align: center;
  border-bottom: 1px solid #f2f4f7;
  transition: background 0.15s;
}
.matrix-cell.highlighted { background: #fafbfc; }
.matrix-cell.highlighted.has-perm { background: #f0f9eb; }
.check-icon {
  width: 22px;
  height: 22px;
  margin: 0 auto;
  border-radius: 4px;
  background: #19be6b;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.check-icon.super { background: #0E1D69; }
.dot-icon {
  width: 22px;
  height: 22px;
  margin: 0 auto;
  border-radius: 4px;
  background: #f5f7fa;
  color: #dcdfe6;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: bold;
}
.matrix-legend {
  margin-top: 12px;
  display: flex;
  gap: 20px;
  font-size: 12px;
  color: #909399;
  align-items: center;
  flex-wrap: wrap;
}
.legend-item { display: inline-flex; align-items: center; gap: 6px; }
.legend-check {
  width: 16px;
  height: 16px;
  background: #19be6b;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.legend-check.super { background: #0E1D69; }

/* Roles grid */
.roles-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 10px; }
.role-card { background: #fff; border: 1px solid #ebeef5; border-radius: 4px; padding: 16px; }
.role-card-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
.role-card-tags { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.builtin-badge {
  font-size: 10px;
  color: #909399;
  background: #f5f7fa;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 700;
  font-family: 'Courier New', monospace;
}
.role-key-text { font-size: 11px; color: #909399; font-family: 'Courier New', monospace; }
.role-card-actions { display: flex; gap: 6px; }
.role-desc { font-size: 12px; color: #606266; margin-bottom: 12px; }
.role-perm-count { font-size: 11px; color: #909399; margin-bottom: 6px; }
.role-progress-bar { height: 8px; background: #f5f7fa; border-radius: 4px; overflow: hidden; margin-bottom: 10px; }
.role-progress-fill { height: 100%; transition: width 0.3s; }
.role-group-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.group-mini-tag {
  font-size: 10px;
  font-family: 'Courier New', monospace;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 600;
}

/* Catalog */
.catalog-summary { font-size: 12px; color: #909399; }
.catalog-group { background: #fff; border: 1px solid #ebeef5; border-radius: 4px; margin-bottom: 10px; overflow: hidden; }
.catalog-group-header {
  padding: 10px 16px;
  border-bottom: 1px solid #ebeef5;
  display: flex;
  align-items: center;
  gap: 10px;
}
.group-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
}
.catalog-group-name { font-size: 13px; font-weight: 700; color: #3f3f3f; }
.catalog-group-count { font-size: 11px; color: #909399; font-family: 'Courier New', monospace; }
.catalog-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.catalog-table td { padding: 10px 16px; border-top: 1px solid #f2f4f7; }
.catalog-table code { font-size: 12px; font-family: 'Courier New', monospace; color: #3f3f3f; font-weight: 600; }

/* Audit */
.audit-kind-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
}

/* Drawer */
.drawer-header {
  padding: 18px 22px;
  border-bottom: 1px solid #ebeef5;
  display: flex;
  align-items: center;
  gap: 12px;
}
.drawer-user-title { display: flex; align-items: center; gap: 8px; }
.drawer-user-name { font-size: 17px; font-weight: 800; color: #3f3f3f; }
.drawer-tabs { padding: 0 22px; }
.drawer-body { padding: 14px 22px 20px; overflow: auto; flex: 1; }
.drawer-footer {
  padding: 14px 22px;
  border-top: 1px solid #ebeef5;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fafbfc;
}
.field-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.field-row label { width: 84px; font-size: 12px; color: #909399; text-align: right; flex-shrink: 0; }
.field-row .el-input { flex: 1; }
.readonly-val { font-size: 13px; color: #3f3f3f; font-family: 'Courier New', monospace; }
.hint-box {
  font-size: 12px;
  color: #909399;
  margin-bottom: 14px;
  padding: 10px;
  background: #fafbfc;
  border: 1px dashed #ebeef5;
  border-radius: 4px;
}
.hint-box code { color: #9c27b0; font-family: 'Courier New', monospace; }
.danger-zone {
  margin-top: 20px;
  padding: 14px;
  background: #fef0f0;
  border: 1px solid #fbc4c4;
  border-radius: 4px;
}
.danger-title { font-size: 13px; font-weight: 700; color: #ed4014; margin-bottom: 8px; }

/* Role checklist */
.role-checklist { display: flex; flex-direction: column; gap: 8px; }
.role-check-item {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}
.role-check-item.checked { background: #f5fbff; border-color: #b3d8ff; }
.role-check-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.role-key-inline { font-size: 11px; color: #909399; font-family: 'Courier New', monospace; }
.role-check-desc { font-size: 12px; color: #606266; margin-bottom: 4px; }
.role-check-count { font-size: 11px; color: #909399; }
.empty-grants { padding: 40px; text-align: center; color: #c0c4cc; font-size: 13px; background: #fafbfc; border-radius: 4px; border: 1px dashed #ebeef5; }

/* Effective */
.mini-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
.mini-stat { padding: 12px; border: 1px solid; border-radius: 4px; }
.mini-stat-val { font-size: 22px; font-weight: 800; line-height: 1; font-family: 'Courier New', monospace; }
.mini-stat-label { font-size: 11px; color: #909399; margin-top: 4px; }
.effective-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; }
.effective-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 3px;
  background: #fafbfc;
  font-size: 11px;
  font-family: 'Courier New', monospace;
}
.effective-item.denied { background: #fef0f0; }
.effective-item.allowed { background: #f0f9eb; }
.effective-item code {
  flex: 1;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  color: #c0c4cc;
}
.effective-item.denied code { color: #ed4014; }
.effective-item.allowed code { color: #3f3f3f; }
.effective-indicator {
  width: 14px;
  height: 14px;
  border-radius: 2px;
  flex-shrink: 0;
  background: #dcdfe6;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.effective-indicator.denied { background: #ed4014; }
.effective-indicator.allowed { background: #19be6b; }

.tab-badge { margin-left: 4px; }
</style>
