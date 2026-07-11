import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router/router'
import store from './sto/store'
import { registerMarkdownComponents } from './plugins/markdown'

// Element Plus + webpack-dev-server overlay: the harmless "ResizeObserver loop
// completed with undelivered notifications" warning is reported as a runtime
// error. webpack-dev-server's client registers its error listener in the
// bubbling phase before our app code loads, so a bubble-phase listener here
// would fire too late to block it. Listening in the capture phase guarantees
// we run first regardless of registration order.
const RESIZE_OBSERVER_LOOP_MSG = 'ResizeObserver loop';
const swallow = (e) => {
  const msg = e && (e.message || (e.reason && (e.reason.message || String(e.reason))));
  if (msg && msg.includes(RESIZE_OBSERVER_LOOP_MSG)) {
    e.stopImmediatePropagation();
    if (e.preventDefault) e.preventDefault();
  }
};
window.addEventListener('error', swallow, true);
window.addEventListener('unhandledrejection', swallow, true);

const app = createApp(App)
Object.entries(ElementPlusIconsVue).forEach(([key, component]) => app.component(key, component))

import { ElMessage } from 'element-plus'
app.config.globalProperties.$message = ElMessage

// 全局 429 处理：限流响应统一弹提示，避免每个 .catch 各写一遍
import axios from 'axios'
axios.interceptors.response.use(
  (resp) => resp,
  (error) => {
    if (error && error.response && error.response.status === 429) {
      const data = error.response.data || {}
      ElMessage.warning(data.message || `操作过于频繁，请 ${data.wait || 30} 秒后再试`)
    }
    return Promise.reject(error)
  }
)

import canPlugin from '@/utils/can'
app.use(canPlugin)
registerMarkdownComponents(app)

app.use(ElementPlus).use(ElMessage).use(router).use(store).mount('#app');
