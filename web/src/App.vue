<template>
  <el-container>
    <el-header>
      <myHeader />
    </el-header>
    <el-main>
      <router-view />
    </el-main>
    <!--      <el-footer>-->
    <!--        <myFooter/>-->
    <!--      </el-footer>-->
  </el-container>
</template>

<script>
import myHeader from './components/myHeader.vue'
// import myFooter from './components/myFooter.vue'

export default {
  name: 'App',
  components: {
    myHeader,
    // myFooter,
  },
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  margin: 0 auto;
  color: #2c3e50;
}

.el-table .success {
  --el-table-tr-bg-color: var(--el-color-success-light-9);
}

.el-header {
  position: sticky;
  top: 0;
  z-index: 5;
}
</style>
