<template>
  <el-container class="app-container">
    <el-header class="app-header">
      <myHeader />
    </el-header>
    <el-main class="app-main">
      <router-view :key="$route.fullPath" />
    </el-main>
    <el-footer class="app-footer">
      <div class="footer-brand">
        nywOJ powered by
        <a href="https://github.com/Baymin-ty/nywOJ" target="_blank" class="rainbow">nywOJ</a>
        Developed by
        <span class="footer-author">ty</span>
      </div>
      <div class="footer-icp">
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
  components: { myHeader },
  mounted() {
    axios.post('/api/judge/getLangs').then(res => {
      if (res.status === 200) {
        this.$store.state.langList = res.data.data
      }
    });
  },
}
</script>

<style>
/* ── Reset & Base ─────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  padding-right: 0 !important;
  overflow-y: overlay;
  background: #f5f7fa;
}

#app, li {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
}

/* ── App Layout ───────────────────────────────────────────── */
.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  padding: 0;
  position: sticky;
  top: 0;
  z-index: 20;
  height: auto !important;
}

.app-main {
  padding: 0;
  flex: 1;
  background: #f5f7fa;
}

.app-footer {
  text-align: center;
  font-family: 'Courier New', Courier, monospace;
  background: #fff;
  border-top: 1px solid #ebeef5;
  padding: 16px 20px;
  height: auto !important;
}

.footer-brand {
  font-size: 13px;
  font-weight: 600;
  color: #74767a;
  margin-bottom: 4px;
}

.footer-author {
  color: #2c3e50;
  font-weight: 700;
}

.footer-icp {
  font-size: 12px;
}

/* ── Element Plus Overrides ───────────────────────────────── */
.el-table .success {
  --el-table-tr-bg-color: var(--el-color-success-light-9);
}

.el-table .warning {
  --el-table-tr-bg-color: var(--el-color-warning-light-9);
}

.el-loading-mask {
  z-index: 10;
}

.el-divider--horizontal {
  margin: 10px 0;
}

.el-card__header {
  padding: 14px 18px;
}

.el-message {
  margin-top: 50px;
}

/* ── Global Card Header ───────────────────────────────────── */
.card-header,
.el-dialog__header,
.el-form-item__label {
  font-weight: bolder;
  color: #3f3f3f;
}

/* ── Global Link ──────────────────────────────────────────── */
.rlink {
  text-decoration: none;
  font-weight: 500;
  cursor: pointer;
  color: #558CDD;
  transition: color 0.15s;
}
.rlink:hover { color: #2d71d7; }

/* ── Tag text ─────────────────────────────────────────────── */
.tag-text {
  color: white;
  font-weight: 600;
  font-size: 13px;
}

/* ── Rainbow animation ────────────────────────────────────── */
.rainbow {
  margin: 0 6px;
  text-decoration: none;
  background-image: linear-gradient(92deg, rgb(38,243,93) 0%, rgb(254,171,58) 100%);
  color: rgb(38, 82, 243);
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-weight: 600;
  animation: 10s linear 0s infinite normal none running hue;
}

@keyframes hue {
  from { -webkit-filter: hue-rotate(0deg); }
  to   { -webkit-filter: hue-rotate(-360deg); }
}

/* ── Utility ──────────────────────────────────────────────── */
#hidden { margin: 5px; }

blockquote { margin: 0; }

/* ── Page wrapper ─────────────────────────────────────────── */
.page-wrap {
  max-width: 1500px;
  margin: 0 auto;
  padding: 12px;
}

.page-wrap--md  { max-width: 1300px; }
.page-wrap--sm  { max-width: 1200px; }
.page-wrap--sub { max-width: 1250px; }

/* ── Responsive helpers ───────────────────────────────────── */
@media (max-width: 768px) {
  .hide-on-mobile { display: none !important; }
  .page-wrap, .page-wrap--md, .page-wrap--sm, .page-wrap--sub {
    padding: 8px;
  }
}
</style>
