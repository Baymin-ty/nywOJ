<template>
  <div class="common-layout">
    <el-container>
      <el-header>
        <myHeader/>
      </el-header>
      <el-main>
        <cuteRabbit/>
      </el-main>
      <el-footer>
        <myFooter/>
      </el-footer>
    </el-container>
  </div>
</template>

<script>
import cuteRabbit from './components/cuteRabbit.vue'
import myHeader from './components/myHeader.vue'
import myFooter from './components/myFooter.vue'

export default {
  name: 'App',
  components: {
    cuteRabbit,
    myHeader,
    myFooter,
  }
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  margin: 0 auto;
  width: 1500px;
  color: #2c3e50;
}
</style>
