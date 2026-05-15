import { createRouter, createWebHistory } from "vue-router";

import { refreshUserInfo } from '@/assets/common'
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
const userInfo = () => import(/* webpackChunkName: "page-user-info" */ '@/components/user/userInfo.vue')
const userEdit = () => import(/* webpackChunkName: "page-user-edit" */ '@/components/user/edit/userEdit.vue')

const problemList = () => import(/* webpackChunkName: "page-problem-list" */ '@/components/problem/problemList.vue')
const problemView = () => import(/* webpackChunkName: "page-problem-view" */ '@/components/problem/problemView.vue')
const problemEdit = () => import(/* webpackChunkName: "page-problem-edit" */ '@/components/problem/problemEdit.vue')
const problemStat = () => import(/* webpackChunkName: "page-problem-stat" */ "@/components/problem/problemStat.vue");
const caseManage = () => import(/* webpackChunkName: "page-problem-case" */ '@/components/problem/caseManage.vue')

const submissionList = () => import(/* webpackChunkName: "page-submission-list" */ '@/components/submission/submissionList.vue')
const submissionView = () => import(/* webpackChunkName: "page-submission-view" */ '@/components/submission/submissionView.vue')

const contestList = () => import(/* webpackChunkName: "page-contest-list" */ '@/components/contest/contestList.vue')
const contestMain = () => import(/* webpackChunkName: "page-contest-main" */ '@/components/contest/contestMain.vue')
const contestPlayer = () => import(/* webpackChunkName: "page-contest-player" */ '@/components/contest/contestPlayer.vue')
const contestProblem = () => import(/* webpackChunkName: "page-contest-problem" */ '@/components/contest/contestProblem.vue')

const userManage = () => import(/* webpackChunkName: "page-admin-users" */ "@/components/admin/userManage")
const permissionCenter = () => import(/* webpackChunkName: "page-admin-permissions" */ "@/components/admin/permissionCenter")

// Permission-gated routes: route -> [required permission keys, any-of].
const perPermissions = {
  '/admin/usermanage':  ['user.manage', 'user.role.admin'],
  '/admin/permissions': ['user.manage', 'user.role.admin'],
};

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
            title: '用户注册',
            activeTitle: '/user/reg'
        },
        path: '/user/reg', component: userReg,
    }, {
        meta: {
            title: '找回密码',
            activeTitle: '/user/login'
        },
        path: '/user/forgot', component: userForgotPassword,
    }, {
        meta: {
            title: '用户管理',
            activeTitle: '/user'
        },
        path: '/admin/usermanage', component: userManage,
    }, {
        meta: {
            title: '权限管理中心',
            activeTitle: '/user'
        },
        path: '/admin/permissions', component: permissionCenter,
    }, {
        meta: {
            title: '用户信息',
            activeTitle: '/user'
        },
        path: '/user/:uid', component: userInfo,
    }, {
        meta: {
            title: '题目列表',
            activeTitle: '/problem'
        },
        path: '/problem', component: problemList,
    }, {
        meta: {
            title: '题目',
            activeTitle: '/problem'
        },
        path: '/problem/:pid', component: problemView,
    }, {
        meta: {
            title: '首页',
            activeTitle: '/'
        },
        path: '/', component: indexPage,
    }, {
        meta: {
            title: '题目管理',
            activeTitle: '/problem'
        },
        path: '/problem/edit/:pid', component: problemEdit,
    }, {
        meta: {
            title: '提交记录',
            activeTitle: '/submission'
        },
        path: '/submission', component: submissionList,
    }, {
        meta: {
            title: '提交记录详情',
            activeTitle: '/submission'
        },
        path: '/submission/:sid', component: submissionView,
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
    if (window.location.hostname !== 'ty.szsyzx.cn' &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== 'niyiwei.com' &&
        window.location.hostname !== 'www.niyiwei.com') {
        window.location.href = 'https://niyiwei.com';
    }
    if (!store.state.uid) {
        await refreshUserInfo();
    }
    if (store.state.uid) {
        const need = perPermissions[to.path];
        if (need && !need.some((k) => (store.state.permissions || []).includes(k))) {
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
            to.path === '/user/login' ||
            to.path === '/user/forgot' ||
            to.path === '/rabbit' ||
            to.path === '/problem' ||
            to.path === '/contest' ||
            to.path === '/submission' ||
            /^\/announcement\/\w+$/.test(to.path)) {
            next();
        } else {
            next({ path: '/user/login' });
        }
    }
})

export default router;
