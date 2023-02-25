import { createRouter, createWebHistory } from "vue-router";

import cuteRabbit from '@/components/cuteRabbit.vue';
import rabbitRankList from '@/components/cuteRankList.vue';
import rabbitClickData from '@/components/rabbitClickData.vue'
import userLogin from "@/components/userLogin.vue";
import userReg from "@/components/userReg.vue";
import userSetEmail from "@/components/userEmail.vue"
import userInfo from '@/components/userInfo.vue'

import userManage from "@/components/admin/userManage"


import axios from "axios";
import store from '@/sto/store';

const per = [];

per["/admin/usermanage"] = 3;

const router = createRouter({
    history: createWebHistory(), routes: [{
        meta: {
            title: '可爱兔兔'
        },
        path: '/', component: cuteRabbit,
    }, {
        meta: {
            title: '兔兔排行榜'
        },
        path: '/rank', component: rabbitRankList,
    }, {
        meta: {
            title: '兔兔统计'
        },
        path: '/data', component: rabbitClickData,
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
            title: '绑定邮箱'
        },
        path: '/user/setemail', component: userSetEmail,
    }, {
        meta: {
            title: '用户管理'
        },
        path: '/admin/usermanage', component: userManage,
    }, {
        meta: {
            title: '用户信息'
        },
        path: '/user/:id', component: userInfo,
    }],
    caseSensitive: true
});
router.afterEach((to) => {
    if (to.meta.title) {
        document.title = to.meta.title
    }
})
router.beforeEach((to, from, next) => {
    if (to.path === '/user/reg' || to.path === '/user/login') {
        next();
    } else {
        axios.post('/api/user/getUserInfo', {
        }).then(res => {
            if (res.data.uid) {
                localStorage.setItem('isLogin', true);
                store.state.uid = res.data.uid;
                store.state.name = res.data.name;
                if (to.path === '/user/setemail') next();
                else if (!res.data.email) next({ path: '/user/setemail' });
                else {
                    if (!per[to.path] || res.data.gid >= per[to.path])
                        next();
                }
            } else {
                store.state.uid = 0;
                store.state.name = "/";
                localStorage.removeItem('isLogin');
                next({ path: '/user/login' });
            }
        });
    }
})

export default router;
