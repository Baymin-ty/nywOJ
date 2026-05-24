import { defineAsyncComponent, h } from 'vue';

const unwrap = (mod) => mod.default || mod;
const LoadingMarkdown = {
  render() {
    return h('div', { class: 'markdown-loading' });
  },
};

let hljsPromise;
let previewPromise;
let editorPromise;

const loadHljs = () => {
  if (!hljsPromise) {
    hljsPromise = Promise.all([
      import(/* webpackChunkName: "markdown-preview" */ 'highlight.js/lib/core'),
      import(/* webpackChunkName: "markdown-preview" */ 'highlight.js/lib/languages/cpp'),
    ]).then(([hljsMod, cppMod]) => {
      const hljs = unwrap(hljsMod);
      hljs.registerLanguage('cpp', unwrap(cppMod));
      return hljs;
    });
  }
  return hljsPromise;
};

const extendXss = (component) => {
  component.xss.extend({
    whiteList: {
      svg: ['preserveaspectratio'],
    },
  });
};

// The copy-code plugin copies on click but gives no feedback. This companion
// plugin briefly swaps the button's copy icon for a green check-mark (~1s) so a
// successful copy is visible. It mirrors copy-code's own preview-plugin pattern
// (a mixin that delegates clicks on the preview element) so it applies to every
// <v-md-preview>/<v-md-editor> with no per-call wiring.
const COPIED_CHECK_HTML =
  '<i style="color:#52c41a"><svg viewBox="64 64 896 896" focusable="false" data-icon="check" '
  + 'width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M912 190h-69.9c-9.8 '
  + '0-19.1 4.5-25.1 12.2L404.7 724.5 207 474a32 32 0 00-25.1-12.2H112c-6.7 0-10.4 7.7-6.3 12.9l273.9 '
  + '347c12.8 16.2 37.4 16.2 50.3 0l488.4-618.9c4.1-5.1.4-12.8-6.3-12.8z"></path></svg></i>';

const getMarkdownPreviewEl = (el) => {
  const cls = 'v-md-editor-preview';
  if (!el || !el.classList) return null;
  return el.classList.contains(cls) ? el : el.querySelector('.' + cls);
};

const findCopyCodeBtn = (el) => {
  let node = el;
  while (node && node.classList) {
    if (node.classList.contains('v-md-copy-code-btn')) return node;
    node = node.parentNode;
  }
  return null;
};

const createCopyFeedbackPlugin = () => ({
  install(VMd) {
    if (!VMd.mixins) VMd.mixins = [];
    VMd.mixins.push({
      mounted() {
        this.$nextTick(() => {
          const previewEl = getMarkdownPreviewEl(this.$el);
          if (previewEl) previewEl.addEventListener('click', this.handleCopyCodeFeedback);
        });
      },
      beforeUnmount() {
        const previewEl = getMarkdownPreviewEl(this.$el);
        if (previewEl) previewEl.removeEventListener('click', this.handleCopyCodeFeedback);
      },
      methods: {
        handleCopyCodeFeedback(e) {
          const btn = findCopyCodeBtn(e.target);
          if (!btn || btn.dataset.copied) return; // ignore while feedback is showing
          const original = btn.innerHTML;
          btn.dataset.copied = '1';
          btn.innerHTML = COPIED_CHECK_HTML;
          setTimeout(() => {
            btn.innerHTML = original;
            delete btn.dataset.copied;
          }, 1000);
        },
      },
    });
  },
});

const loadPreview = () => {
  if (!previewPromise) {
    previewPromise = (async () => {
      const [
        previewMod,
        themeMod,
        copyCodeMod,
        katexMod,
        hljs,
      ] = await Promise.all([
        import(/* webpackChunkName: "markdown-preview" */ '@kangc/v-md-editor/lib/preview'),
        import(/* webpackChunkName: "markdown-preview" */ '@kangc/v-md-editor/lib/theme/github.js'),
        import(/* webpackChunkName: "markdown-preview" */ '@kangc/v-md-editor/lib/plugins/copy-code/index'),
        import(/* webpackChunkName: "markdown-preview" */ '@kangc/v-md-editor/lib/plugins/katex/cdn'),
        loadHljs(),
        import(/* webpackChunkName: "markdown-preview" */ '@kangc/v-md-editor/lib/plugins/copy-code/copy-code.css'),
        import(/* webpackChunkName: "markdown-preview" */ '@kangc/v-md-editor/lib/theme/style/github.css'),
      ]);

      const VMdPreview = unwrap(previewMod);
      extendXss(VMdPreview);
      VMdPreview
        .use(unwrap(themeMod), { Hljs: hljs })
        .use(unwrap(katexMod)())
        .use(unwrap(copyCodeMod)())
        .use(createCopyFeedbackPlugin());
      return VMdPreview;
    })();
  }
  return previewPromise;
};

const loadEditor = () => {
  if (!editorPromise) {
    editorPromise = (async () => {
      const Codemirror = unwrap(await import(/* webpackChunkName: "markdown-editor" */ 'codemirror'));
      const [
        editorMod,
        themeMod,
        copyCodeMod,
        katexMod,
        hljs,
      ] = await Promise.all([
        import(/* webpackChunkName: "markdown-editor" */ '@kangc/v-md-editor/lib/codemirror-editor'),
        import(/* webpackChunkName: "markdown-editor" */ '@kangc/v-md-editor/lib/theme/github.js'),
        import(/* webpackChunkName: "markdown-editor" */ '@kangc/v-md-editor/lib/plugins/copy-code/index'),
        import(/* webpackChunkName: "markdown-editor" */ '@kangc/v-md-editor/lib/plugins/katex/cdn'),
        loadHljs(),
        import(/* webpackChunkName: "markdown-editor" */ '@kangc/v-md-editor/lib/plugins/copy-code/copy-code.css'),
        import(/* webpackChunkName: "markdown-editor" */ '@kangc/v-md-editor/lib/style/codemirror-editor.css'),
        import(/* webpackChunkName: "markdown-editor" */ '@kangc/v-md-editor/lib/theme/style/github.css'),
        import(/* webpackChunkName: "markdown-editor" */ 'codemirror/lib/codemirror.css'),
        import(/* webpackChunkName: "markdown-editor" */ 'codemirror/mode/markdown/markdown'),
        import(/* webpackChunkName: "markdown-editor" */ 'codemirror/mode/javascript/javascript'),
        import(/* webpackChunkName: "markdown-editor" */ 'codemirror/mode/css/css'),
        import(/* webpackChunkName: "markdown-editor" */ 'codemirror/mode/htmlmixed/htmlmixed'),
        import(/* webpackChunkName: "markdown-editor" */ 'codemirror/mode/vue/vue'),
        import(/* webpackChunkName: "markdown-editor" */ 'codemirror/addon/edit/closebrackets'),
        import(/* webpackChunkName: "markdown-editor" */ 'codemirror/addon/edit/closetag'),
        import(/* webpackChunkName: "markdown-editor" */ 'codemirror/addon/edit/matchbrackets'),
        import(/* webpackChunkName: "markdown-editor" */ 'codemirror/addon/display/placeholder'),
        import(/* webpackChunkName: "markdown-editor" */ 'codemirror/addon/selection/active-line'),
        import(/* webpackChunkName: "markdown-editor" */ 'codemirror/addon/scroll/simplescrollbars'),
        import(/* webpackChunkName: "markdown-editor" */ 'codemirror/addon/scroll/simplescrollbars.css'),
      ]);

      const VMdEditor = unwrap(editorMod);
      VMdEditor.Codemirror = Codemirror;
      extendXss(VMdEditor);
      VMdEditor
        .use(unwrap(themeMod), { Hljs: hljs })
        .use(unwrap(katexMod)())
        .use(unwrap(copyCodeMod)())
        .use(createCopyFeedbackPlugin());
      return VMdEditor;
    })();
  }
  return editorPromise;
};

export const registerMarkdownComponents = (app) => {
  app.component('v-md-preview', defineAsyncComponent({
    loader: loadPreview,
    loadingComponent: LoadingMarkdown,
  }));
  app.component('v-md-editor', defineAsyncComponent({
    loader: loadEditor,
    loadingComponent: LoadingMarkdown,
  }));
};
