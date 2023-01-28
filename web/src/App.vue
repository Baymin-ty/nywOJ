<template>
  <div class="common-layout">
    <el-container>
      <el-header>
        <myHeader/>
      </el-header>
      <el-main>
        <router-view/>
      </el-main>
      <el-footer>
        <myFooter/>
      </el-footer>
    </el-container>
  </div>
</template>

<script>
import myHeader from './components/myHeader.vue'
import myFooter from './components/myFooter.vue'

export default {
  name: 'App',
  components: {
    myHeader,
    myFooter,
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
</style>
