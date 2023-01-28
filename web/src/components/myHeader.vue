<template>
  <div style="height: 40px; line-height: 40px;">
    <div class="title">
      <img alt="OJ-icon" style="height: 40px;  position: relative" src="../assets/rabbit.png">
    </div>
    <div class="title">
      <a href="/">首页</a>
    </div>
    <div class="title">
      <a href="/rank">点击排行</a>
    </div>
    <div class="title">
      题库
    </div>
    <div class="title">
      比赛
    </div>
    <div class="title">
      提交记录
    </div>
    <div style="float: right">
      个人中心
    </div>
  </div>
</template>

<script>
export default {
  name: "myHeader"
}
</script>

<style scoped>
div {
  margin: 10px;
}

div.title {
  float: left;
  height: 40px;
  width: auto;
  margin-left: 40px;
}

el-col {
  margin: 0;
}
</style>