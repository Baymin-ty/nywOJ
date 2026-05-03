import { createStore } from 'vuex'

export default createStore({
    state: {
        uid: 0,
        name: "/",
        ip: '',
        path: '',
        avatar: '',
        reDirectTo: '/',
        langList: [],
        preferenceLang: null,
        permissions: [],
    },
    mutations: {
        setPermissions(state, list) {
            state.permissions = Array.isArray(list) ? list : [];
        },
    },
    actions: {},
    modules: {}
})
