import {createRouter, createWebHistory} from "vue-router";

import cuteRabbit from '@/components/cuteRabbit.vue';
import rabbitRankList from '@/components/cuteRankList.vue';
import userLogin from "@/components/userLogin.vue";
import userReg from "@/components/userReg.vue";
import axios from "axios";
import store from '@/sto/store';

const router = createRouter({
    history: createWebHistory(), routes: [{
        path: '/', component: cuteRabbit,
    }, {
        path: '/rank', component: rabbitRankList,
    }, {
        path: '/user/login', component: userLogin,
    }, {
        path: '/user/reg', component: userReg,
    }]
});

router.beforeEach((to, from, next) => {
    if (to.path === '/user/reg' || to.path === '/user/login') {
        next();
    } else {
        axios.get('http://localhost:1234/api/user/getUserInfo', {
            params: {
                token: localStorage.getItem('token')
            }
        }).then(res => {
            if (res.data.status === 200) {
                store.state.uid = res.data.uid;
                store.state.name = res.data.name;
                next();
            } else {
                store.state.uid = 0;
                store.state.name = "/";
                localStorage.removeItem('token');
                next({path: '/user/login'});
            }
        });
    }
})

export default router;
