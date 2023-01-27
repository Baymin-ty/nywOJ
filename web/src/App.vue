<template>
  <div class="common-layout">
    <el-container>
      <el-header>
        <myHeader/>
      </el-header>
      <el-main>
        <el-row>
          <el-col :span="15">
            <cuteRabbit/>
          </el-col>
          <el-col :span="8">
            <click-list/>
          </el-col>
        </el-row>
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
import clickList from './components/clickList.vue'

export default {
  name: 'App',
  components: {
    cuteRabbit,
    myHeader,
    myFooter,
    clickList
  }
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  margin-left: 100px;
  margin-right: 100px;
  color: #2c3e50;
}
</style>
