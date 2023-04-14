import { createRouter, createWebHistory } from "vue-router";

import indexPage from '@/components/indexPage.vue'
import NotFound from '@/components/NotFoundPage.vue'

import AnnouncementView from '@/components/announcement/announcementView.vue'
import AnnouncementEdit from '@/components/announcement/announcementEdit.vue'

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
        await axios.post('/api/user/getUserInfo', {
        }).then(res => {
            if (res.status === 200) {
                store.state.uid = res.data.uid;
                store.state.name = res.data.name;
                store.state.gid = res.data.gid;
            }
        });
    }
    if (to.path === '/' || to.path === '/user/reg' || to.path === '/user/login')
        next();
    else if (store.state.uid) {
        if (!per[to.path] || store.state.gid >= per[to.path])
            next();
    } else {
        next({ path: '/user/login' });
    }
})

export default router;
