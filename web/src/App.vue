<template>
  <el-container class="app-shell">
    <el-header>
      <myHeader />
    </el-header>
    <el-main>
      <router-view :key="routerViewKey" />
    </el-main>
    <el-footer id="footer">
      <div style="font-weight: 600; color:#74767a">
        nywOJ powered by
        <a href="https://github.com/Baymin-ty/nywOJ" target="_blank" class="rainbow">nywOJ</a>
        Developed by
        <span style="color: black;">ty</span>
      </div>
      <div>
        <a href="https://beian.miit.gov.cn/" target="_blank" class="rainbow">苏ICP备2025197653号-1</a>
      </div>
    </el-footer>
  </el-container>
</template>

<script>
import myHeader from './components/myHeader.vue'
import axios from "axios";

export default {
  name: 'App',
  components: {
    myHeader,
  },
  computed: {
    routerViewKey() {
      if (/^\/problem\/case\/\d+$/.test(this.$route.path)) return this.$route.path;
      return this.$route.fullPath;
    }
  },
  mounted() {
    axios.post('/api/judge/getLangs').then(res => {
      if (res.status === 200) {
        this.$store.state.langList = res.data.data
      }
    }).catch(() => {
      this.$store.state.langList = {};
    });

  },
}
</script>

<style>
li,
#app {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, "Cascadia Code", "Cascadia Mono", Consolas, "Liberation Mono", monospace, Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  margin: 0 auto;
  color: #2c3e50;
}

.app-shell {
  min-height: 100vh;
  min-width: 0;
}

.el-table .success {
  --el-table-tr-bg-color: var(--el-color-success-light-9);
}

.el-table .warning {
  --el-table-tr-bg-color: var(--el-color-warning-light-9);
}

.el-header {
  padding: 0;
  position: sticky;
  top: 0;
  z-index: 20;
}

.el-loading-mask {
  z-index: 10;
}

body {
  margin: 0;
  padding-right: 0 !important;
  overflow-y: overlay;
}

html,
body,
#app {
  min-width: 0;
  max-width: 100%;
}

html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

.el-main {
  min-width: 0;
}

.card-header,
.el-dialog__header,
.el-form-item__label {
  font-weight: bolder;
  color: #3f3f3f;
}

.rlink {
  text-decoration: none;
  font-weight: 500;
  cursor: pointer;
  color: #558CDD;
}

.rlink:hover {
  color: #2d71d7;
}

blockquote {
  margin: 0;
}

#hidden {
  margin: 5px;
}

.el-card__header {
  padding: 15px 18px;
}

.rainbow {
  margin: 10px;
  text-decoration: none;
  background-image: linear-gradient(92deg, rgb(38, 243, 93) 0%, rgb(254, 171, 58) 100%);
  color: rgb(38, 82, 243);
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-weight: 600;
  animation: 10s linear 0s infinite normal none running hue;
}

@keyframes hue {
  from {
    -webkit-filter: hue-rotate(0deg);
  }

  to {
    -webkit-filter: hue-rotate(-360deg);
  }
}

#footer {
  text-align: center;
  font-family: 'Courier New', Courier, monospace;
  margin-bottom: 5px;
}

#footer>div {
  margin: 5px;
}

@media (max-width: 768px) {
  .hide-on-mobile {
    display: none !important;
  }
}

.el-message {
  margin-top: 50px;
}

@media (max-width: 900px) {
  .el-header {
    height: calc(56px + env(safe-area-inset-top));
  }
}

@media (max-width: 768px) {
  html,
  body,
  #app {
    width: 100%;
    overflow-x: hidden;
  }

  body {
    overflow-x: hidden;
    overflow-y: auto;
  }

  .el-main {
    padding: 8px !important;
  }

  .el-main > * {
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }

  .el-card__header {
    padding: 12px;
  }

  .el-card__body {
    padding: 12px;
  }

  .card-header {
    height: auto !important;
    min-height: 28px;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .el-row {
    min-width: 0 !important;
  }

  .el-col {
    min-width: 0 !important;
    max-width: 100%;
  }

  /* 仅清零路由内容区里的行内 min-width（多为页面根容器的 min-width: 600/800px），
     避免移动端横向滚动。限定在 .el-main 内，不波及顶栏 / 底栏 / 弹窗等全局元素。 */
  .el-main [style*="min-width"] {
    min-width: 0 !important;
  }

  .el-form--inline {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .el-form--inline .el-form-item {
    display: block;
    margin-right: 0 !important;
    margin-bottom: 0 !important;
  }

  .el-form--inline .el-form-item__content,
  .el-form--inline .el-input,
  .el-form--inline .el-select {
    width: 100% !important;
  }

  .el-form-item,
  .el-form-item__content,
  .el-input,
  .el-input-number,
  .el-select,
  .el-date-editor {
    min-width: 0;
    max-width: 100%;
  }

  .el-form-item__label {
    height: auto;
    line-height: 1.35;
    white-space: normal;
  }

  .el-input__inner,
  .el-select__input,
  .el-textarea__inner {
    font-size: 16px;
  }

  .el-button-group {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .el-button-group > .el-button {
    border-radius: 4px !important;
    margin-left: 0 !important;
  }

  .el-pagination {
    max-width: 100%;
    white-space: normal;
    justify-content: center;
  }

  .el-pagination .el-pagination__sizes,
  .el-pagination .el-pagination__jump {
    margin-left: 4px;
  }

  .el-table {
    font-size: 12px;
  }

  .el-button {
    min-height: 36px;
  }

  button,
  a,
  .el-button,
  .el-menu-item,
  .el-dropdown-menu__item {
    touch-action: manipulation;
  }

  .el-dialog {
    width: calc(100vw - 20px) !important;
    margin-top: 5vh !important;
  }

  .el-dialog__body {
    max-height: 70vh;
    max-height: 70dvh;
    padding: 14px;
    overflow-y: auto;
  }

  .el-dialog__footer {
    padding: 10px 14px 14px;
  }

  .el-message-box {
    width: calc(100vw - 20px) !important;
    max-width: 420px;
  }

  .el-message,
  .el-notification {
    width: calc(100vw - 20px) !important;
    min-width: 0 !important;
    max-width: 420px;
    box-sizing: border-box;
  }

  .el-notification {
    right: 10px !important;
  }

  .el-popper,
  .el-dropdown__popper,
  .el-select__popper,
  .el-picker__popper,
  .el-cascader__dropdown {
    max-width: calc(100vw - 16px) !important;
    box-sizing: border-box;
  }

  .el-select-dropdown__wrap,
  .el-cascader-panel {
    max-height: min(60vh, 480px);
    max-height: min(60dvh, 480px);
  }

  .el-dropdown__popper .el-scrollbar__wrap {
    max-height: min(60vh, 480px);
    max-height: min(60dvh, 480px);
    overscroll-behavior: contain;
  }

  .el-dropdown-menu__item {
    min-height: 44px;
  }

  .el-select-dropdown,
  .el-select-dropdown__item,
  .el-cascader-node,
  .el-picker-panel {
    max-width: calc(100vw - 20px) !important;
  }

  .el-cascader-panel {
    overflow-x: auto;
    overscroll-behavior: contain;
  }

  .el-picker-panel__body-wrapper {
    max-width: 100%;
    overflow-x: auto;
  }

  pre,
  code,
  .v-md-editor-preview {
    max-width: 100%;
    box-sizing: border-box;
  }

  pre {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  img,
  video,
  iframe,
  .v-md-editor-preview img {
    max-width: 100%;
  }

  img,
  video {
    height: auto;
  }

  #footer {
    font-size: 12px;
    padding: 0 8px max(8px, env(safe-area-inset-bottom));
  }
}
</style>
