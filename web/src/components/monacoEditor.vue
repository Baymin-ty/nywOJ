<template>
  <div ref="editorContainer" :style="`height: ${height}px`" />
</template>

<script>
import { defineComponent, onMounted, onBeforeUnmount, ref, watch } from 'vue';

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
    }
  },


  emits: ['update:value'], // 定义一个自定义事件，用于更新父组件的 value

  setup(props, { emit }) {
    const editorContainer = ref(null);
    let editor;

    onMounted(async () => {
      const monacoEditor = await import(/* webpackChunkName: "monaco-editor" */ 'monaco-editor');
      editor = monacoEditor.editor.create(editorContainer.value, {
        value: props.value,
        language: props.language,
        theme: props.theme,
        readOnly: props.readOnly,
        fontSize: props.fontSize,
        automaticLayout: true
      });

      // 监听编辑器内容变化
      editor.onDidChangeModelContent(() => {
        const newValue = editor.getValue();
        emit('update:value', newValue);
      });
    });

    watch(() => props.value, (newValue) => {
      if (editor && newValue !== editor.getValue()) {
        editor.setValue(newValue);
      }
    });

    watch(() => props.language, (newLanguage) => {
      if (editor) {
        editor.setModelLanguage(editor.getModel(), newLanguage);
      }
    });

    watch(() => props.readOnly, (newReadOnly) => {
      if (editor) {
        editor.updateOptions({ readOnly: newReadOnly });
      }
    });

    watch(() => props.fontSize, (newSize) => {
      if (editor) {
        editor.updateOptions({ fontSize: newSize });
      }
    });

    onBeforeUnmount(() => {
      if (editor) {
        editor.dispose();
      }
    });

    return {
      editorContainer,
    };
  },
});
</script>

<style scoped></style>
