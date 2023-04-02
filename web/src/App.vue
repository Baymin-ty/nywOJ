<template>
  <el-container style="min-width: 600px;">
    <el-header>
      <myHeader />
    </el-header>
    <el-main>
      <router-view :key="$route.fullPath" />
    </el-main>
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

.card-header {
  font-weight: bolder;
}

.rlink {
  cursor: pointer;
  color: #558CDD;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-thumb {
  background-color: #c5c6c8;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background-color: #b1b1b4;
  border-radius: 3px;
}
</style>
