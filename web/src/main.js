import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import {
  Back,
  Check,
  CircleCheck,
  CirclePlus,
  Close,
  CloseBold,
  DataAnalysis,
  DataLine,
  Delete,
  Document,
  DocumentAdd,
  Edit,
  Files,
  Guide,
  Hide,
  Histogram,
  InfoFilled,
  Key,
  Lock,
  Lollipop,
  Operation,
  Place,
  Plus,
  Refresh,
  RefreshLeft,
  Remove,
  Search,
  Setting,
  SetUp,
  SwitchButton,
  Trophy,
  Upload,
  UploadFilled,
  User,
  UserFilled,
} from '@element-plus/icons-vue'
import App from './App.vue'
// import axios from 'axios'
// import VueAxios from 'vue-axios'
import router from './router/router'
import store from './sto/store'
import { registerMarkdownComponents } from './plugins/markdown'

// Element Plus + webpack-dev-server overlay: the harmless "ResizeObserver loop
// completed with undelivered notifications" warning is reported as a runtime
// error. webpack-dev-server's client registers its error listener in the
// bubbling phase before our app code loads, so a bubble-phase listener here
// would fire too late to block it. Listening in the capture phase guarantees
// we run first regardless of registration order.
//
// Belt-and-suspenders: also debounce ResizeObserver callbacks to one per
// animation frame, which prevents the loop from firing in the first place.
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

if (typeof window.ResizeObserver === 'function') {
  const RawRO = window.ResizeObserver;
  window.ResizeObserver = class DebouncedRO extends RawRO {
    constructor(cb) {
      let frame = 0;
      const wrapped = (entries, obs) => {
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          frame = 0;
          try { cb(entries, obs); } catch (err) {
            const msg = err && err.message;
            if (!msg || !msg.includes(RESIZE_OBSERVER_LOOP_MSG)) throw err;
          }
        });
      };
      super(wrapped);
    }
  };
}

const app = createApp(App)
const icons = {
  Back,
  Check,
  CircleCheck,
  CirclePlus,
  Close,
  CloseBold,
  DataAnalysis,
  DataLine,
  Delete,
  Document,
  DocumentAdd,
  Edit,
  Files,
  Guide,
  Hide,
  Histogram,
  InfoFilled,
  Key,
  Lock,
  Lollipop,
  Operation,
  Place,
  Plus,
  Refresh,
  RefreshLeft,
  Remove,
  Search,
  Setting,
  SetUp,
  SwitchButton,
  Trophy,
  Upload,
  UploadFilled,
  User,
  UserFilled,
}
Object.entries(icons).forEach(([key, component]) => app.component(key, component))

import { ElMessage } from 'element-plus'
app.config.globalProperties.$message = ElMessage

import canPlugin from '@/utils/can'
app.use(canPlugin)
registerMarkdownComponents(app)

app.use(ElementPlus).use(ElMessage).use(router).use(store).mount('#app');
