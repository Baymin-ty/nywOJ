import { createStore } from 'vuex'

export default createStore({
    state: {
        uid: 0,
        name: "/",
        gid: 0,
        ip: '',
        path: '',
        avatar: '',
        reDirectTo: '/',
        langList: [],
        preferenceLang: null,
    },
    mutations: {},
    actions: {},
    modules: {}
})
