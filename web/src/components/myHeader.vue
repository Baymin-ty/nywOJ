<template>
  <el-menu
      class="el-menu-demo"
      mode="horizontal"
      :default-active="activeIndex"
      :router="true">
    <img style="width: 50px; height: 50px; margin-left: 30px; margin-right: 30px" src="../assets/rabbit.png">
    <el-menu-item index="/">首页</el-menu-item>
    <el-menu-item index="/rank">兔兔挑战排行榜</el-menu-item>
    <el-menu-item index="3" disabled>题库</el-menu-item>
    <el-menu-item index="4" disabled>比赛</el-menu-item>
    <el-menu-item index="5" disabled>提交记录</el-menu-item>
  </el-menu>
</template>

<script>
export default {
  name: "myHeader",
  data() {
    return {
      activeIndex: '',
    }
  },
  mounted() {
    // this.activeIndex = this.$route.curentRoute.path;
    console.log(this.$route.fullPath);
  }
}
</script>

<style>

</style>