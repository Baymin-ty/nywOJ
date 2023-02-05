<template>
  <el-menu class="el-menu-demo" mode="horizontal" :default-active="this.$router.path" :router="true">
    <img style="width: 40px; height: 40px; margin-left: 30px; margin-right: 30px; margin-top: 5px; border-radius: 5px"
      src="../assets/icon.png">
    <el-menu-item index="/">首页</el-menu-item>
    <el-menu-item index="/rank">兔兔挑战排行榜</el-menu-item>
    <el-menu-item v-show="!uid" index="/user/login">登录</el-menu-item>
    <el-menu-item v-show="!uid" index="/user/reg">注册</el-menu-item>
    <el-button v-show="uid" style="height: 55px; width: 100px; padding: 0;" text @click="logout">退出登录</el-button>
    <el-button style="height: 55px; width: 80px; padding: 0;" text @click="dialogVisible = true">打赏</el-button>
    <el-dialog v-model="dialogVisible" title="实施可持续发展战略" width="400px" style="border-radius: 10px" class="pd">
      <el-divider />
      <div style="height: 40px">
        <el-select v-model="money" class="m-2" placeholder="Select" style="width: 100px">
          <el-option v-for="item in options" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </div>
      <img v-show="money === 50" class="round" alt="50" src="../assets/50.png">
      <img v-show="money === 100" class="round" alt="100" src="../assets/100.png">
      <img v-show="money === 300" class="round" alt="300" src="../assets/300.png">
    </el-dialog>
    <el-icon>
      <Bell />
    </el-icon>
  </el-menu>
</template>

<script>
import axios from "axios";

export default {
  name: "myHeader",
  data() {
    return {
      uid: 0,
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
  mounted() {
    axios.get('/api/user/getUserInfo', {
      params: {
        token: localStorage.getItem('token')
      }
    }).then(res => {
      if (res.data.status === 200) {
        this.uid = res.data.uid;
      }
    });
  },
  methods: {
    logout() {
      localStorage.removeItem('token');
      location.reload();
    }
  },
}
</script>

<style>
::-webkit-scrollbar {
  width: 0;
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