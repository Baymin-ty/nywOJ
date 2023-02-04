import {createRouter, createWebHistory} from "vue-router";

import cuteRabbit from '@/components/cuteRabbit.vue';
import rabbitRankList from '@/components/cuteRankList.vue';
import userLogin from "@/components/userLogin.vue";
import userReg from "@/components/userReg.vue";

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: '/',
            component: cuteRabbit,
        }, {
            path: '/rank',
            component: rabbitRankList,
        }, {
            path: '/user/login',
            component: userLogin,
        }, {
            path: '/user/reg',
            component: userReg,
        }
    ]
})
export default router;
