<template>
  <el-menu class="el-menu-demo" mode="horizontal" :default-active="curPath" :router="true">
    <img v-show="!this.$store.state.uid"
      style="width: 40px; height: 40px; margin-top: 10px; margin-right: 20px; border-radius: 5px"
      src="../assets/icon.png">
    <el-menu-item index="/rabbit" style="height: auto;" v-show="this.$store.state.uid">
      <img style="width: 40px; height: 40px; margin-top: 5px; border-radius: 5px" src="../assets/icon.png">
    </el-menu-item>
    <el-menu-item index="/">
      <el-icon>
        <Lollipop />
      </el-icon>
      首页
    </el-menu-item>
    <el-menu-item v-show="this.$store.state.uid" index="/problem">
      <el-icon>
        <Files />
      </el-icon>
      题库
    </el-menu-item>
    <el-menu-item v-show="this.$store.state.uid" index="/submission">
      <el-icon>
        <DataAnalysis />
      </el-icon>
      提交记录
    </el-menu-item>
    <el-menu-item v-show="!this.$store.state.uid" index="/user/login">
      <el-icon>
        <User />
      </el-icon>
      登录
    </el-menu-item>
    <el-menu-item v-show="!this.$store.state.uid" index="/user/reg">
      <el-icon>
        <CircleCheck />
      </el-icon>
      注册
    </el-menu-item>
    <el-sub-menu index="/user/" v-show="this.$store.state.uid">
      <template #title>
        <el-icon>
          <User />
        </el-icon>
        {{ this.$store.state.name }}
      </template>
      <el-menu-item :width="120" :index="/user/ + this.$store.state.uid">
        <el-icon>
          <UserFilled />
        </el-icon>
        个人主页
      </el-menu-item>
      <el-menu-item :width="120" v-show="this.$store.state.gid === 3" index="/admin/usermanage">
        <el-icon>
          <Operation />
        </el-icon>
        用户管理
      </el-menu-item>
      <el-menu-item :width="120">
        <el-icon>
          <Close />
        </el-icon>
        <span @click="logout">退出登录</span>
      </el-menu-item>
    </el-sub-menu>
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
      curPath: '',
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
      axios.post('/api/user/logout').then(() => {
        this.$store.state.uid = 0;
        this.$store.state.name = '/';
        this.$store.state.gid = 0;
        location.reload();
      });
    },
  },
  watch: {
    '$route.path'(newVal) {
      this.curPath = newVal;
    }
  },
  mounted() {
    setTimeout(() => { this.curPath = this.$route.path; }, 100);
  }
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