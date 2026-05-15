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
        .use(unwrap(copyCodeMod)());
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
        .use(unwrap(copyCodeMod)());
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
