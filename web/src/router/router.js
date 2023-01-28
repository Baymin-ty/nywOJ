import {createRouter, createWebHistory} from "vue-router";
import cuteRabbit from '../components/cuteRabbit.vue';
import rabbitRankList from '../components/cuteRankList.vue';

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: '/',
            component: cuteRabbit,
        },
        {
            path: '/rank',
            component: rabbitRankList,
        },
    ]
})
export default router;
