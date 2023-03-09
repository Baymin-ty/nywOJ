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
            title: '可爱兔兔'
        },
        path: '/rabbit', component: cuteRabbit,
    }, {
        meta: {
            title: '用户登录'
        },
        path: '/user/login', component: userLogin,
    }, {
        meta: {
            title: '用户注册'
        },
        path: '/user/reg', component: userReg,
    }, {
        meta: {
            title: '用户管理'
        },
        path: '/admin/usermanage', component: userManage,
    }, {
        meta: {
            title: '用户信息'
        },
        path: '/user/:uid', component: userInfo,
    }, {
        meta: {
            title: '题目列表'
        },
        path: '/problem', component: problemList,
    }, {
        meta: {
            title: '题目'
        },
        path: '/problem/:pid', component: problemView,
    }, {
        meta: {
            title: '首页'
        },
        path: '/', component: indexPage,
    }, {
        meta: {
            title: '题目管理'
        },
        path: '/problem/edit/:pid', component: problemEdit,
    }, {
        meta: {
            title: '提交记录'
        },
        path: '/submission', component: submissionList,
    }, {
        meta: {
            title: '提交记录详情'
        },
        path: '/submission/:sid', component: submissionView,
    }, {
        path: '/:catchAll(.*)',
        name: '404',
        component: NotFound
    }, {
        meta: {
            title: '公告'
        },
        path: '/announcement/:aid', component: AnnouncementView,
    }, {
        meta: {
            title: '编辑公告'
        },
        path: '/announcement/edit/:aid', component: AnnouncementEdit,
    }],
    caseSensitive: true
});
router.afterEach((to) => {
    if (to.meta.title) {
        document.title = to.meta.title
    }
})
router.beforeEach((to, from, next) => {
    axios.post('/api/user/getUserInfo', {
    }).then(res => {
        store.state.uid = res.data.uid;
        store.state.name = res.data.name;
        store.state.gid = res.data.gid;
        if (to.path === '/' || to.path === '/user/reg' || to.path === '/user/login')
            next();
        else if (res.data.uid) {
            if (!per[to.path] || res.data.gid >= per[to.path])
                next();
        } else {
            next({ path: '/user/login' });
        }
    });
})

export default router;
