<template>
  <div ref="container" :style="`height: ${height}px`"></div>
</template>

<script>
import * as monaco from "monaco-editor";

export default {
  name: "monacoEditor",
  props: {
    monacoOptions: {
      type: Object,
      default: () => {
        return {
          value: "",
          theme: "vs",
        };
      }
    },
    height: {
      type: Number,
      default: 600
    }
  },
  mounted() {
    this.init();
  },
  methods: {
    init() {
      this.$refs.container.innerHTML = "";
      this.editorOptions = this.monacoOptions;
      this.monacoEditor = monaco.editor.create(
        this.$refs.container,
        this.editorOptions
      );
      this.monacoEditor.onDidChangeModelContent(() => {
        this.$emit("change", this.monacoEditor.getValue());
        this.$emit("input", this.monacoEditor.getValue());
      });
    },
    getVal() {
      return this.monacoEditor.getValue();
    }
  },
};
</script>
