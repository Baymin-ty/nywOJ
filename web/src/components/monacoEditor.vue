<template>
  <div ref="editorContainer" class="monaco-host" :style="`height: ${height}px`" />
</template>

<script>
import { defineComponent, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';

export default defineComponent({
  name: 'monacoEditor',

  props: {
    language: {
      type: String,
      default: 'cpp',
    },
    value: {
      type: String,
      default: '// your code\n',
    },
    theme: {
      type: String,
      default: 'vs-light',
    },
    readOnly: {
      type: Boolean,
      default: false,
    },
    height: {
      type: Number,
      default: 550
    },
    fontSize: {
      type: Number,
      default: 15
    },
    tabSize: {
      type: Number,
      default: 4
    },
    insertSpaces: {
      type: Boolean,
      default: true
    },
    wordWrap: {
      type: String,
      default: 'off'
    },
    minimap: {
      type: Boolean,
      default: false
    },
    lineNumbers: {
      type: String,
      default: 'on'
    },
    renderWhitespace: {
      type: String,
      default: 'selection'
    },
    bracketPairColorization: {
      type: Boolean,
      default: true
    },
    bracketPairGuides: {
      type: Boolean,
      default: false
    }
  },


  emits: ['update:value'], // 定义一个自定义事件，用于更新父组件的 value

  setup(props, { emit }) {
    const editorContainer = ref(null);
    let monacoEditor, editor, contentDisposable;
    let disposed = false;

    const runtimeOptions = () => ({
      readOnly: props.readOnly,
      fontSize: props.fontSize,
      tabSize: props.tabSize,
      insertSpaces: props.insertSpaces,
      detectIndentation: false,
      wordWrap: props.wordWrap,
      minimap: { enabled: props.minimap },
      lineNumbers: props.lineNumbers,
      renderWhitespace: props.renderWhitespace,
      scrollBeyondLastLine: false,
      bracketPairColorization: { enabled: props.bracketPairColorization },
      guides: { bracketPairs: props.bracketPairGuides },
    });

    onMounted(async () => {
      await nextTick();
      if (disposed || !editorContainer.value || !editorContainer.value.isConnected) return;
      monacoEditor = await import(/* webpackChunkName: "monaco-editor" */ 'monaco-editor/esm/vs/editor/editor.api');
      await nextTick();
      const container = editorContainer.value;
      if (disposed || !container || !container.isConnected) return;
      editor = monacoEditor.editor.create(container, {
        value: props.value,
        language: props.language,
        theme: props.theme,
        automaticLayout: true,
        ...runtimeOptions(),
      });

      // 监听编辑器内容变化
      contentDisposable = editor.onDidChangeModelContent(() => {
        if (!editor) return;
        const newValue = editor.getValue();
        emit('update:value', newValue);
      });
    });

    watch(() => props.value, (newValue) => {
      if (editor && !disposed && newValue !== editor.getValue()) {
        // setValue lives on the editor instance, not the module namespace.
        editor.setValue(newValue);
      }
    });

    watch(() => props.language, (newLanguage) => {
      if (monacoEditor && editor && editor.getModel()) {
        monacoEditor.editor.setModelLanguage(editor.getModel(), newLanguage);
      }
    });

    watch(() => props.theme, (newTheme) => {
      if (monacoEditor && newTheme) {
        monacoEditor.editor.setTheme(newTheme);
      }
    });

    watch(() => [
      props.readOnly,
      props.fontSize,
      props.tabSize,
      props.insertSpaces,
      props.wordWrap,
      props.minimap,
      props.lineNumbers,
      props.renderWhitespace,
      props.bracketPairColorization,
      props.bracketPairGuides,
    ], () => {
      if (editor) editor.updateOptions(runtimeOptions());
    });

    onBeforeUnmount(() => {
      disposed = true;
      if (contentDisposable) {
        contentDisposable.dispose();
        contentDisposable = null;
      }
      if (editor) {
        editor.dispose();
        editor = null;
      }
    });

    return {
      editorContainer,
    };
  },
});
</script>

<style scoped>
.monaco-host {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}
</style>
