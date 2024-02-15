<template>
  <el-container style="min-width: 992px;">
    <el-header>
      <myHeader />
    </el-header>
    <el-main>
      <router-view :key="$route.fullPath" />
    </el-main>
    <el-footer id="footer">
      <div style="font-weight: 600; color:#74767a">
        nywOJ powered by
        <a href="https://github.com/Baymin-ty/nywOJ" target="_blank" class="rainbow">nywOJ</a>
        Developed by
        <span style="color: black;">ty</span>
      </div>
      <div>
        <a href="https://beian.miit.gov.cn/" target="_blank" class="rainbow">黑ICP备2022006586号-1</a>
      </div>
    </el-footer>
  </el-container>
</template>

<script>
import myHeader from './components/myHeader.vue'

export default {
  name: 'App',
  components: {
    myHeader,
  },
}
</script>

<style>
li,
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  margin: 0 auto;
  color: #2c3e50;
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
  margin-top: 0;
  padding-right: 0 !important;
  overflow-y: overlay;
}

.card-header,
.el-dialog__header,
.el-form-item__label {
  font-weight: bolder;
  color: #3f3f3f;
}

.rlink {
  cursor: pointer;
  color: #558CDD;
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
}

#footer>div {
  margin: 5px;
}

@media (max-width: 768px) {
  .hide-on-mobile {
    display: none !important;
  }
}
</style>
