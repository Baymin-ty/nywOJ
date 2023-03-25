<template>
  <el-menu class="el-menu-demo" mode="horizontal" :default-active="this.$router.path" :router="true">
    <el-menu-item index="/rabbit" style="height: auto;">
      <img style="width: 40px; height: 40px; margin-top: 5px; border-radius: 5px" src="../assets/icon.png">
    </el-menu-item>
    <el-menu-item index="/">首页</el-menu-item>
    <el-menu-item v-show="this.uid" index="/problem">题库</el-menu-item>
    <el-menu-item v-show="this.uid" index="/submission">提交记录</el-menu-item>
    <el-menu-item v-show="!uid" index="/user/login">登录</el-menu-item>
    <el-menu-item v-show="!uid" index="/user/reg">注册</el-menu-item>
    <el-sub-menu index="/user/" v-show="uid">
      <template #title>{{ this.name }}</template>
      <el-menu-item :width="100" :index="/user/ + this.uid"> 个人主页 </el-menu-item>
      <el-menu-item :width="100" v-show="gid === 3" index="/admin/usermanage">用户管理</el-menu-item>
      <span @click="logout"><el-menu-item :width="100">退出登录</el-menu-item></span>
    </el-sub-menu>
    <el-button style=" height: 55px; width: 80px; padding: 0; margin: 0;" text
      @click="dialogVisible = true">打赏</el-button>
    <el-dialog :lock-scroll="false" v-model="dialogVisible" title="实施可持续发展战略" width="400px"
      style="border-radius: 10px;text-align: center;" class="pd">
      <el-divider />
      <div style="height: 40px">
        <el-select v-model="money" class="m-2" placeholder="Select" style="width: 110px">
          <el-option v-for="item in options" :key="item.value" :label="item.label" :value="item.value"
            style="width: 110px" />
        </el-select>
      </div>
      <img v-show="money === 50" class="round" alt="50" src="../assets/50.png">
      <img v-show="money === 100" class="round" alt="100" src="../assets/100.png">
      <img v-show="money === 300" class="round" alt="300" src="../assets/300.png">
    </el-dialog>
  </el-menu>
</template>

<script>
import axios from "axios";

export default {
  name: "myHeader",
  data() {
    return {
      uid: 0,
      name: "/",
      gid: 1,
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
  methods: {
    logout() {
      axios.post('/api/user/logout');
      localStorage.removeItem('isLogin');
      location.reload();
    }
  },
  async mounted() {
    await axios.post('/api/user/getUserInfo', {
    }).then(res => {
      this.name = res.data.name;
      this.uid = res.data.uid;
      this.gid = res.data.gid;
    });
  },
}
</script>

<style>
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

.el-menu--collapse .el-menu .el-submenu,
.el-menu--popup {
  min-width: 100px !important;
  font-size: 10px;
}

.el-menu {
  justify-content: center;
}
</style>