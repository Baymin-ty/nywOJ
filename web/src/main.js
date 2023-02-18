import {createApp} from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import axios from 'axios'
import VueAxios from 'vue-axios'
import router from './router/router'
import 'default-passive-events'

const app = createApp(App)
app.use(ElementPlus).use(VueAxios, axios).use(router).mount('#app');
