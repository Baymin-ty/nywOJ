import { createRouter, createWebHistory } from "vue-router";

import indexPage from '@/components/indexPage.vue'
import NotFound from '@/components/NotFoundPage.vue'

import AnnouncementView from '@/components/announcement/announcementView.vue'
import AnnouncementEdit from '@/components/announcement/announcementEdit.vue'
import pasteView from "@/components/paste/pasteView.vue";
import pasteEdit from "@/components/paste/pasteEdit.vue";
import pasteList from "@/components/paste/pasteList.vue"

import cuteRabbit from '@/components/rabbit/cuteRabbit.vue'
import userLogin from "@/components/user/userLogin.vue"
import userReg from "@/components/user/userReg.vue"
import userInfo from '@/components/user/userInfo.vue'
import problemList from '@/components/problem/problemList.vue'
import problemView from '@/components/problem/problemView.vue'
import problemEdit from '@/components/problem/problemEdit.vue'
import caseManage from '@/components/problem/caseManage.vue'
import submissionList from '@/components/submission/submissionList.vue'
import submissionView from '@/components/submission/submissionView.vue'
import contestList from '@/components/contest/contestList.vue'
import contestMain from '@/components/contest/contestMain.vue'
import contestPlayer from '@/components/contest/contestPlayer.vue'
import contestProblem from '@/components/contest/contestProblem.vue'
import userEdit from '@/components/user/edit/userEdit.vue'

import userManage from "@/components/admin/userManage"

import axios from "axios";
import store from '@/sto/store';

const per = [];

per["/admin/usermanage"] = 3;

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
            title: '用户管理',
            activeTitle: '/user'
        },
        path: '/admin/usermanage', component: userManage,
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
        window.location.href = 'https://ty.szsyzx.cn';
    }
    if (!store.state.uid) {
        await axios.post('/api/user/getUserInfo').then(res => {
            if (res.status === 200) {
                store.state.uid = res.data.uid;
                store.state.name = res.data.name;
                store.state.gid = res.data.gid;
                store.state.ip = res.data.ip;
                store.state.avatar = res.data.avatar;
            }
        });
    }
    if (to.path === '/' ||
        to.path === '/user/reg' ||
        to.path === '/user/login' ||
        to.path === '/rabbit' ||
        to.path === '/problem' ||
        to.path === '/contest' ||
        to.path === '/submission' ||
        /^\/announcement\/\w+$/.test(to.path))
        next();
    else if (store.state.uid) {
        if (!per[to.path] || store.state.gid >= per[to.path])
            next();
    } else {
        next({ path: '/user/login' });
    }
})

export default router;
