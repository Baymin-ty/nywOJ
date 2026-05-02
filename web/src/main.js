import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
// import axios from 'axios'
// import VueAxios from 'vue-axios'
import router from './router/router'
import store from './sto/store'

import VMdEditor from '@kangc/v-md-editor/lib/codemirror-editor';
import VMdPreview from '@kangc/v-md-editor/lib/preview';
import createCopyCodePlugin from '@kangc/v-md-editor/lib/plugins/copy-code/index';
import '@kangc/v-md-editor/lib/plugins/copy-code/copy-code.css';
import '@kangc/v-md-editor/lib/style/codemirror-editor.css';
import githubTheme from '@kangc/v-md-editor/lib/theme/github.js';
import '@kangc/v-md-editor/lib/theme/style/github.css';

// highlightjs 核心代码
import hljs from 'highlight.js/lib/core';
// 按需引入语言包
import cpp from 'highlight.js/lib/languages/cpp';

hljs.registerLanguage('cpp', cpp);

// codemirror 编辑器的相关资源
import Codemirror from 'codemirror';

// mode
import 'codemirror/mode/markdown/markdown';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/mode/css/css';
import 'codemirror/mode/htmlmixed/htmlmixed';
import 'codemirror/mode/vue/vue';
// edit
import 'codemirror/addon/edit/closebrackets';
import 'codemirror/addon/edit/closetag';
import 'codemirror/addon/edit/matchbrackets';
// placeholder
import 'codemirror/addon/display/placeholder';
// active-line
import 'codemirror/addon/selection/active-line';
// scrollbar
import 'codemirror/addon/scroll/simplescrollbars';
import 'codemirror/addon/scroll/simplescrollbars.css';
// style
import 'codemirror/lib/codemirror.css';

// 解决根号渲染问题
VMdEditor.xss.extend({
  // 扩展白名单
  whiteList: {
    // preserveAspectRatio 注意要小写
    svg: ['preserveaspectratio']
  }
});
VMdPreview.xss.extend({
  whiteList: {
    svg: ['preserveaspectratio']
  }
});

VMdEditor.Codemirror = Codemirror;
VMdEditor.use(githubTheme, {
  Hljs: hljs,
});
VMdPreview.use(githubTheme, {
  Hljs: hljs,
});

import createKatexPlugin from '@kangc/v-md-editor/lib/plugins/katex/cdn';
VMdEditor.use(createKatexPlugin()).use(createCopyCodePlugin());
VMdPreview.use(createKatexPlugin()).use(createCopyCodePlugin());

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
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

import { ElMessage } from 'element-plus'
app.config.globalProperties.$message = ElMessage

import canPlugin from '@/utils/can'
app.use(canPlugin)

app.use(ElementPlus).use(ElMessage).use(router).use(store).use(VMdEditor).use(VMdPreview).mount('#app');
