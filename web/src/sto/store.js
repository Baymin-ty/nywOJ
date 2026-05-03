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
        isRoot: false,
    },
    mutations: {
        setPermissions(state, list) {
            state.permissions = Array.isArray(list) ? list : [];
        },
        setIsRoot(state, v) { state.isRoot = !!v; },
    },
    actions: {},
    modules: {}
})
