import { createRouter, createWebHistory } from "vue-router";
import axios from "axios";

import { refreshUserInfo, userProfilePath } from '@/assets/common'
import store from '@/sto/store';

const indexPage = () => import(/* webpackChunkName: "page-home" */ '@/components/indexPage.vue')
const NotFound = () => import(/* webpackChunkName: "page-base" */ '@/components/NotFoundPage.vue')

const AnnouncementView = () => import(/* webpackChunkName: "page-announcement" */ '@/components/announcement/announcementView.vue')
const AnnouncementEdit = () => import(/* webpackChunkName: "page-announcement-edit" */ '@/components/announcement/announcementEdit.vue')
const pasteView = () => import(/* webpackChunkName: "page-paste" */ "@/components/paste/pasteView.vue");
const pasteEdit = () => import(/* webpackChunkName: "page-paste-edit" */ "@/components/paste/pasteEdit.vue");
const pasteList = () => import(/* webpackChunkName: "page-paste-list" */ "@/components/paste/pasteList.vue")

const cuteRabbit = () => import(/* webpackChunkName: "page-rabbit" */ '@/components/rabbit/cuteRabbit.vue')
const userLogin = () => import(/* webpackChunkName: "page-user-auth" */ "@/components/user/userLogin.vue")
const userReg = () => import(/* webpackChunkName: "page-user-auth" */ "@/components/user/userReg.vue")
const userForgotPassword = () => import(/* webpackChunkName: "page-user-auth" */ "@/components/user/userForgotPassword.vue")
const userList = () => import(/* webpackChunkName: "page-users" */ '@/components/user/userList.vue')
const userInfo = () => import(/* webpackChunkName: "page-user-info" */ '@/components/user/userInfo.vue')
const userEdit = () => import(/* webpackChunkName: "page-user-edit" */ '@/components/user/edit/userEdit.vue')

const problemList = () => import(/* webpackChunkName: "page-problem-list" */ '@/components/problem/problemList.vue')
const problemView = () => import(/* webpackChunkName: "page-problem-view" */ '@/components/problem/problemView.vue')
const problemEdit = () => import(/* webpackChunkName: "page-problem-edit" */ '@/components/problem/problemEdit.vue')
const problemAiAssistant = () => import(/* webpackChunkName: "page-problem-ai" */ '@/components/problem/problemAiAssistant.vue')
const problemCreateRedirect = () => import(/* webpackChunkName: "page-problem-create" */ '@/components/problem/problemCreateRedirect.vue')
const problemStat = () => import(/* webpackChunkName: "page-problem-stat" */ "@/components/problem/problemStat.vue");
const problemSubmissionStatistics = () => import(/* webpackChunkName: "page-problem-statistics" */ "@/components/problem/problemSubmissionStatistics.vue");
const caseManage = () => import(/* webpackChunkName: "page-problem-case" */ '@/components/problem/caseManage.vue')

const onlineIde = () => import(/* webpackChunkName: "page-ide" */ '@/components/ide/onlineIde.vue')

const submissionList = () => import(/* webpackChunkName: "page-submission-list" */ '@/components/submission/submissionList.vue')
const submissionView = () => import(/* webpackChunkName: "page-submission-view" */ '@/components/submission/submissionView.vue')
const discussionList = () => import(/* webpackChunkName: "page-discussion-list" */ '@/components/discussion/discussionList.vue')
const discussionView = () => import(/* webpackChunkName: "page-discussion-view" */ '@/components/discussion/discussionView.vue')
const discussionEdit = () => import(/* webpackChunkName: "page-discussion-edit" */ '@/components/discussion/discussionEdit.vue')
const discussionCreateRedirect = () => import(/* webpackChunkName: "page-discussion-create" */ '@/components/discussion/discussionCreateRedirect.vue')

const contestList = () => import(/* webpackChunkName: "page-contest-list" */ '@/components/contest/contestList.vue')
const homeworkList = () => import(/* webpackChunkName: "page-homework-list" */ '@/components/contest/homeworkList.vue')
const contestMain = () => import(/* webpackChunkName: "page-contest-main" */ '@/components/contest/contestMain.vue')
const contestPlayer = () => import(/* webpackChunkName: "page-contest-player" */ '@/components/contest/contestPlayer.vue')
const contestProblem = () => import(/* webpackChunkName: "page-contest-problem" */ '@/components/contest/contestProblem.vue')

const systemManage = () => import(/* webpackChunkName: "page-admin-system" */ "@/components/admin/systemManage")
const permissionCenter = () => import(/* webpackChunkName: "page-admin-permissions" */ "@/components/admin/permissionCenter")

// Permission-gated routes: route -> [required permission keys, any-of].
const perPermissions = {
  '/admin/permissions': ['user.manage', 'user.role.admin'],
};

const systemTabPermissions = {
  groups: ['group.manage'],
  judge: ['judge.monitor.view', 'judge.client.manage'],
  tags: ['problem.tag.manage'],
  rating: ['system.rating.manage'],
  migration: ['system.migration.manage'],
  homepage: ['system.homepage.manage'],
};

const allSystemPermissions = [...new Set(
  Object.keys(systemTabPermissions).reduce((keys, tab) => keys.concat(systemTabPermissions[tab]), [])
)];

const hasAnyPermission = (keys) =>
  keys.some((k) => (store.state.permissions || []).includes(k));

const requiredPermissionsForRoute = (to) => {
  if (perPermissions[to.path]) return perPermissions[to.path];
  if (to.path === '/system' || to.path.startsWith('/system/')) {
    const tab = String((to.params && to.params.tab) || '').trim();
    return systemTabPermissions[tab] || allSystemPermissions;
  }
  return null;
};

const numericParam = (value) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};

const normalizeEditTab = (type) => {
  const tab = String(type || 'profile').toLowerCase();
  if (tab === 'preference') return 'profile';
  if (['profile', 'security', 'session', 'audit'].includes(tab)) return tab;
  return 'profile';
};

const redirectOwnUserEdit = (to, from, next) => {
  const username = String(to.params.username || '');
  if (store.state.name && username === store.state.name) {
    next({ path: '/user/edit', query: { tab: normalizeEditTab(to.params.type) } });
    return;
  }
  next({ path: userProfilePath(username) });
};

const redirectOwnUserIdEdit = (to, from, next) => {
  const uid = numericParam(to.params.uid);
  if (uid && store.state.uid === uid) {
    next({ path: '/user/edit', query: { tab: normalizeEditTab(to.params.type) } });
    return;
  }
  next({ path: `/user/${uid || to.params.uid}` });
};

const redirectUserIdToUsername = async (to, from, next) => {
  const uid = numericParam(to.params.uid);
  if (!uid) {
    next('/users');
    return;
  }
  try {
    const res = await axios.post('/api/user/getUserMeta', { userId: uid });
    const username = res && res.data && res.data.meta && res.data.meta.username;
    if (username) {
      next({
        path: userProfilePath(username),
        query: to.query,
        hash: to.hash,
        replace: true,
      });
      return;
    }
  } catch (_) {
    next();
    return;
  }
  next();
};

const tagIdsQuery = (value) => ({
  tagIds: String(value || '')
    .split(',')
    .map((item) => Number(item))
    .filter((item) => Number.isSafeInteger(item) && item > 0)
    .join(','),
});

const oldStatisticsTypePath = (type) => ({
  shortest: 'minanswersize',
  min: 'minmemory',
}[String(type || '').toLowerCase()] || String(type || 'fastest').toLowerCase());

const USERNAME_ROUTE_RE = /^[A-Za-z0-9\-_.#$]{3,24}$/;

const isPublicUserProfileRoute = (to) =>
    to.matched.some((record) => record.path === '/u/:username') &&
    USERNAME_ROUTE_RE.test(String(to.params.username || ''));

const router = createRouter({
    history: createWebHistory(),
    routes: [{
        meta: {
            title: '可爱兔兔',
            activeTitle: '/rabbit'
        },
        path: '/rabbit', component: cuteRabbit,
    }, {
        meta: {
            title: '用户登录',
            activeTitle: '/user/login'
        },
        path: '/user/login', component: userLogin,
    }, {
        meta: {
            title: '用户登录',
            activeTitle: '/user/login'
        },
        path: '/login', component: userLogin,
    }, {
        meta: {
            title: '用户注册',
            activeTitle: '/user/reg'
        },
        path: '/user/reg', component: userReg,
    }, {
        meta: {
            title: '用户注册',
            activeTitle: '/user/reg'
        },
        path: '/register', component: userReg,
    }, {
        meta: {
            title: '找回密码',
            activeTitle: '/user/login'
        },
        path: '/user/forgot', component: userForgotPassword,
    }, {
        meta: {
            title: '找回密码',
            activeTitle: '/user/login'
        },
        path: '/forgot', component: userForgotPassword,
    }, {
        meta: {
            title: '系统管理',
            activeTitle: '/user'
        },
        path: '/system', component: systemManage,
    }, {
        meta: {
            title: '系统管理',
            activeTitle: '/user'
        },
        path: '/system/:tab', component: systemManage,
    }, {
        meta: {
            title: '权限管理中心',
            activeTitle: '/user'
        },
        path: '/admin/permissions', component: permissionCenter,
    }, {
        path: '/admin/usermanage', redirect: '/admin/permissions',
    }, {
        path: '/admin/judge', redirect: '/system/judge',
    }, {
        path: '/admin/migration', redirect: '/system/migration',
    }, {
        path: '/admin/rating', redirect: '/system/rating',
    }, {
        path: '/admin/problem-tags', redirect: '/system/tags',
    }, {
        meta: {
            title: '用户榜',
            activeTitle: '/users'
        },
        path: '/users', component: userList,
    }, {
        meta: {
            title: '用户榜',
            activeTitle: '/users'
        },
        path: '/u', component: userList,
    }, {
        meta: {
            title: '用户信息',
            activeTitle: '/users'
        },
        path: '/u/:username/edit/:type?', beforeEnter: redirectOwnUserEdit,
    }, {
        meta: {
            title: '用户信息',
            activeTitle: '/users'
        },
        path: '/u/:username', component: userInfo,
    }, {
        meta: {
            title: '用户信息',
            activeTitle: '/users'
        },
        path: '/user/:uid(\\d+)/edit/:type?', beforeEnter: redirectOwnUserIdEdit,
    }, {
        meta: {
            title: '用户信息',
            activeTitle: '/users'
        },
        path: '/user/:uid', component: userInfo, beforeEnter: redirectUserIdToUsername,
    }, {
        meta: {
            title: '题目列表',
            activeTitle: '/problem'
        },
        path: '/problem', component: problemList,
    }, {
        meta: {
            title: '题目列表',
            activeTitle: '/problem'
        },
        path: '/p', component: problemList,
    }, {
        path: '/problems', redirect: to => ({ path: '/p', query: to.query }),
    }, {
        path: '/problems/search', redirect: to => ({ path: '/p', query: to.query }),
    }, {
        path: '/problems/tag/:ids', redirect: to => ({ path: '/p', query: tagIdsQuery(to.params.ids) }),
    }, {
        meta: {
            title: '在线 IDE',
            activeTitle: '/ide'
        },
        path: '/ide', component: onlineIde,
    }, {
        meta: {
            title: '在线 IDE',
            activeTitle: '/ide'
        },
        path: '/ide/:pid(\\d+)', component: onlineIde,
    }, {
        meta: {
            title: '提交统计榜',
            activeTitle: '/problem'
        },
        path: '/problem/statistics/:pid/:type?', component: problemSubmissionStatistics,
    }, {
        meta: {
            title: '提交统计榜',
            activeTitle: '/problem'
        },
        path: '/p/id/:pid(\\d+)/statistics/:type?', component: problemSubmissionStatistics,
    }, {
        meta: {
            title: '提交统计榜',
            activeTitle: '/problem'
        },
        path: '/p/:pid(\\d+)/statistics/:type?',
        redirect: to => `/problem/statistics/${to.params.pid}/${to.params.type || 'fastest'}`,
    }, {
        meta: {
            title: '新建题目',
            activeTitle: '/problem'
        },
        path: '/p/new', component: problemCreateRedirect,
    }, {
        meta: {
            title: '题目管理',
            activeTitle: '/problem'
        },
        path: '/p/id/:pid(\\d+)/edit', component: problemEdit,
    }, {
        meta: {
            title: 'LLM 出题助手',
            activeTitle: '/problem'
        },
        path: '/p/id/:pid(\\d+)/ai', component: problemAiAssistant,
    }, {
        meta: {
            title: '题目数据',
            activeTitle: '/problem'
        },
        path: '/p/id/:pid(\\d+)/files',
        redirect: to => ({ path: `/problem/case/${to.params.pid}`, query: { ...to.query, tab: 'data' } }),
    }, {
        meta: {
            title: '题目管理',
            activeTitle: '/problem'
        },
        path: '/p/id/:pid(\\d+)/judge-settings',
        redirect: to => ({ path: `/problem/case/${to.params.pid}`, query: { ...to.query, tab: 'profile' } }),
    }, {
        meta: {
            title: '题目',
            activeTitle: '/problem'
        },
        path: '/p/id/:pid(\\d+)', component: problemView,
    }, {
        meta: {
            title: '题目管理',
            activeTitle: '/problem'
        },
        path: '/p/:pid(\\d+)/edit',
        redirect: to => `/problem/edit/${to.params.pid}`,
    }, {
        meta: {
            title: 'LLM 出题助手',
            activeTitle: '/problem'
        },
        path: '/p/:pid(\\d+)/ai',
        redirect: to => `/problem/ai/${to.params.pid}`,
    }, {
        meta: {
            title: '题目数据',
            activeTitle: '/problem'
        },
        path: '/p/:pid(\\d+)/files',
        redirect: to => ({ path: `/problem/case/${to.params.pid}`, query: { ...to.query, tab: 'data' } }),
    }, {
        meta: {
            title: '题目管理',
            activeTitle: '/problem'
        },
        path: '/p/:pid(\\d+)/judge-settings',
        redirect: to => ({ path: `/problem/case/${to.params.pid}`, query: { ...to.query, tab: 'profile' } }),
    }, {
        meta: {
            title: '题目',
            activeTitle: '/problem'
        },
        path: '/p/:pid(\\d+)', redirect: to => `/problem/${to.params.pid}`,
    }, {
        meta: {
            title: '题目',
            activeTitle: '/problem'
        },
        path: '/problem/:pid', component: problemView,
    }, {
        path: '/problem/0/edit', redirect: '/p/new',
    }, {
        path: '/problem/:pid(\\d+)/manage', redirect: to => `/problem/case/${to.params.pid}`,
    }, {
        path: '/problem/:pid(\\d+)/additional_file', redirect: to => ({ path: `/problem/case/${to.params.pid}`, query: { tab: 'data' } }),
    }, {
        path: '/problem/:pid(\\d+)/testdata', redirect: to => ({ path: `/problem/case/${to.params.pid}`, query: { tab: 'data' } }),
    }, {
        path: '/problem/:pid(\\d+)/statistics/:type', redirect: to => `/problem/statistics/${to.params.pid}/${oldStatisticsTypePath(to.params.type)}`,
    }, {
        meta: {
            title: '首页',
            activeTitle: '/'
        },
        path: '/', component: indexPage,
    }, {
        path: '/homepage-settings', redirect: '/system/homepage',
    }, {
        meta: {
            title: '题目管理',
            activeTitle: '/problem'
        },
        path: '/problem/edit/:pid', component: problemEdit,
    }, {
        meta: {
            title: 'LLM 出题助手',
            activeTitle: '/problem'
        },
        path: '/problem/ai/:pid', component: problemAiAssistant,
    }, {
        meta: {
            title: '提交记录',
            activeTitle: '/submission'
        },
        path: '/submission', component: submissionList,
    }, {
        meta: {
            title: '提交记录',
            activeTitle: '/submission'
        },
        path: '/s', component: submissionList,
    }, {
        path: '/submissions', redirect: to => ({ path: '/s', query: to.query }),
    }, {
        meta: {
            title: '提交记录详情',
            activeTitle: '/submission'
        },
        path: '/submission/:sid', component: submissionView,
    }, {
        meta: {
            title: '提交记录详情',
            activeTitle: '/submission'
        },
        path: '/s/:sid(\\d+)', component: submissionView,
    }, {
        path: '/ranklist', redirect: '/users',
    }, {
        meta: {
            title: '讨论区',
            activeTitle: '/discussion'
        },
        path: '/discussion', component: discussionList,
    }, {
        meta: {
            title: '讨论区',
            activeTitle: '/discussion'
        },
        path: '/d', component: discussionList,
    }, {
        path: '/discussion/global', redirect: to => ({ path: '/d', query: to.query }),
    }, {
        path: '/discussion/problems', redirect: to => ({ path: '/d', query: { ...to.query, problemId: 'all' } }),
    }, {
        path: '/discussion/problem/:pid(\\d+)', redirect: to => ({ path: '/d', query: { ...to.query, problemId: to.params.pid } }),
    }, {
        path: '/article/0/edit', redirect: to => ({ path: '/d/new', query: to.query }),
    }, {
        path: '/article/:did(\\d+)', redirect: to => `/d/${to.params.did}`,
    }, {
        path: '/article/:did(\\d+)/edit', redirect: to => `/d/${to.params.did}/edit`,
    }, {
        meta: {
            title: '新建讨论',
            activeTitle: '/discussion'
        },
        path: '/d/new', component: discussionCreateRedirect,
    }, {
        meta: {
            title: '讨论详情',
            activeTitle: '/discussion'
        },
        path: '/discussion/:did', component: discussionView,
    }, {
        meta: {
            title: '讨论详情',
            activeTitle: '/discussion'
        },
        path: '/d/:did(\\d+)', component: discussionView,
    }, {
        meta: {
            title: '编辑讨论',
            activeTitle: '/discussion'
        },
        path: '/discussion/edit/:did', component: discussionEdit,
    }, {
        meta: {
            title: '编辑讨论',
            activeTitle: '/discussion'
        },
        path: '/d/:did(\\d+)/edit', component: discussionEdit,
    }, {
        meta: {
            title: '404 Error',
            activeTitle: '/'
        },
        path: '/:catchAll(.*)',
        name: '404',
        component: NotFound
    }, {
        meta: {
            title: '公告',
            activeTitle: '/'
        },
        path: '/announcement/:aid', component: AnnouncementView,
    }, {
        meta: {
            title: '编辑公告',
            activeTitle: '/'
        },
        path: '/announcement/edit/:aid', component: AnnouncementEdit,
    }, {
        meta: {
            title: '数据管理',
            activeTitle: '/problem'
        },
        path: '/problem/case/:pid', component: caseManage,
    }, {
        meta: {
            title: '比赛列表',
            activeTitle: '/contest'
        },
        path: '/contest', component: contestList,
    }, {
        meta: {
            title: '作业列表',
            activeTitle: '/homework'
        },
        path: '/homework', component: homeworkList,
    }, {
        meta: {
            title: '比赛',
            activeTitle: '/contest'
        },
        path: '/contest/:cid', component: contestMain,
    }, {
        meta: {
            title: '选手列表',
            activeTitle: '/contest'
        },
        path: '/contest/player/:cid', component: contestPlayer,
    }, {
        meta: {
            title: '比赛题目',
            activeTitle: '/contest'
        },
        path: '/contest/:cid/problem/:idx', component: contestProblem,
    }, {
        meta: {
            title: '用户设置',
            activeTitle: '/user'
        },
        path: '/user/edit', component: userEdit,
    }, {
        path: '/groups', redirect: '/system/groups',
    }, {
        meta: {
            title: '查看剪贴板',
            activeTitle: '/user'
        },
        path: '/paste/:mark', component: pasteView,
    }, {
        meta: {
            title: '编辑剪贴板',
            activeTitle: '/user'
        },
        path: '/paste/edit/:mark', component: pasteEdit,
    }, {
        meta: {
            title: '剪贴板列表',
            activeTitle: '/user'
        },
        path: '/paste', component: pasteList,
    }, {
        meta: {
            title: '数据统计',
            activeTitle: '/problem'
        },
        path: '/problem/stat/:pid', component: problemStat,
    }],
    caseSensitive: true
});
router.afterEach((to) => {
    store.state.activeTitle = to.meta.activeTitle;
    if (to.meta.title) {
        document.title = to.meta.title
    }
})
router.beforeEach(async (to, from, next) => {
    if (!store.state.uid) {
        await refreshUserInfo();
    }
    if (store.state.uid) {
        const need = requiredPermissionsForRoute(to);
        if (need && !hasAnyPermission(need)) {
            next(false);
            return;
        }
        next();
    }
    else {
        if (to.path !== '/user/login')
            store.state.reDirectTo = { path: to.path, query: to.query };
        if (to.path === '/' ||
            to.path === '/user/reg' ||
            to.path === '/register' ||
            to.path === '/user/login' ||
            to.path === '/login' ||
            to.path === '/user/forgot' ||
            to.path === '/forgot' ||
            to.path === '/users' ||
            to.path === '/u' ||
            isPublicUserProfileRoute(to) ||
            /^\/user\/\d+$/.test(to.path) ||
            to.path === '/rabbit' ||
            to.path === '/problem' ||
            to.path === '/p' ||
            to.path === '/problems' ||
            /^\/problems\/tag\/[\d,]+$/.test(to.path) ||
            /^\/problem\/\d+$/.test(to.path) ||
            /^\/p\/id\/\d+$/.test(to.path) ||
            /^\/p\/\d+$/.test(to.path) ||
            to.path === '/contest' ||
            to.path === '/homework' ||
            to.path === '/submission' ||
            to.path === '/submissions' ||
            to.path === '/s' ||
            to.path === '/discussion' ||
            to.path === '/discussion/global' ||
            to.path === '/discussion/problems' ||
            to.path === '/d' ||
            /^\/discussion\/\d+$/.test(to.path) ||
            /^\/discussion\/problem\/\d+$/.test(to.path) ||
            /^\/d\/\d+$/.test(to.path) ||
            /^\/article\/\d+$/.test(to.path) ||
            /^\/announcement\/\w+$/.test(to.path)) {
            next();
        } else {
            next({ path: '/user/login' });
        }
    }
})

export default router;
