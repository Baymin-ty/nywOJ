<template>
  <el-menu
      class="el-menu-demo"
      mode="horizontal"
      :default-active="path"
      :router="true">
    <img style="width: 40px; height: 40px; margin-left: 30px; margin-right: 30px; margin-top: 5px; border-radius: 5px"
         src="../assets/icon.png">
    <el-menu-item index="/">首页</el-menu-item>
    <el-menu-item index="/rank">兔兔挑战排行榜</el-menu-item>
    <el-button style="height: 55px; width: 80px; padding: 0;" text @click="dialogVisible = true">打赏</el-button>
    <el-menu-item index="/p" disabled>题库</el-menu-item>
    <el-menu-item index="/c" disabled>比赛</el-menu-item>
    <el-menu-item index="/s" disabled>提交记录</el-menu-item>
    <el-dialog v-model="dialogVisible"
               title="实施可持续发展战略"
               width="400px"
               style="border-radius: 10px"
               class="pd">
      <el-divider/>
      <div style="height: 40px">
        <el-select v-model="money" class="m-2" placeholder="Select" style="width: 100px">
          <el-option
              v-for="item in options"
              :key="item.value"
              :label="item.label"
              :value="item.value"
          />
        </el-select>
      </div>
      <img v-show="money===50" class="round" alt="50" src="../assets/50.png">
      <img v-show="money===100" class="round" alt="100" src="../assets/100.png">
      <img v-show="money===300" class="round" alt="300" src="../assets/300.png">
    </el-dialog>
  </el-menu>
</template>

<script>
export default {
  name: "myHeader",
  data() {
    return {
      path: "/",
      dialogVisible: false,
      money: 50,
      options: [{
        value: 50,
        label: '一包辣条',
      }, {
        value: 100,
        label: '一根冰棍',
      }, {
        value: 300,
        label: '一瓶可乐',
      }],
    }
  },
}
</script>

<style>
body {
  padding-right: 0 !important;
  overflow: hidden;
}

.round {
  height: 400px;
  border-radius: 10px;
  margin: 10px;
}

.pd .el-dialog__body {
  padding: 0;
}

.el-divider--horizontal {
  margin: 10px 0;
}
</style>