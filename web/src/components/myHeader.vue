<template>
  <el-menu mode="horizontal" :default-active="this.$store.state.activeTitle" :router="true">
    <el-menu-item index="/rabbit" style="height: auto">
      <img style="margin-top: 3px;" src="../assets/icon.png" class="icon">
    </el-menu-item>
    <el-menu-item index="/">
      <el-icon>
        <Lollipop />
      </el-icon>
      首页
    </el-menu-item>
    <el-menu-item index="/problem">
      <el-icon>
        <Files />
      </el-icon>
      题库
    </el-menu-item>
    <el-menu-item index="/contest">
      <el-icon>
        <Trophy />
      </el-icon>
      比赛
    </el-menu-item>
    <el-menu-item index="/submission">
      <el-icon>
        <DataAnalysis />
      </el-icon>
      提交记录
    </el-menu-item>
    <el-menu-item v-if="!this.$store.state.uid" index="/user/login">
      <el-icon>
        <User />
      </el-icon>
      登录
    </el-menu-item>
    <el-menu-item v-if="!this.$store.state.uid" index="/user/reg">
      <el-icon>
        <CircleCheck />
      </el-icon>
      注册
    </el-menu-item>
    <el-sub-menu index="/user" v-if="this.$store.state.uid">
      <template #title>
        <el-avatar :size="35" :src="this.$store.state.avatar" />
        <span style="padding-left: 8px;"> {{ this.$store.state.name }} </span>
      </template>
      <el-menu-item :index="/user/ + this.$store.state.uid">
        <el-icon>
          <UserFilled />
        </el-icon>
        个人主页
      </el-menu-item>
      <el-menu-item index="/user/edit">
        <el-icon>
          <Edit />
        </el-icon>
        编辑资料
      </el-menu-item>
      <el-menu-item v-if="this.$store.state.gid === 3" index="/admin/usermanage">
        <el-icon>
          <Operation />
        </el-icon>
        用户管理
      </el-menu-item>
      <el-menu-item index="/paste">
        <el-icon>
          <Document />
        </el-icon>
        剪贴板板
      </el-menu-item>
      <span @click="logout">
        <el-menu-item>
          <el-icon>
            <Close />
          </el-icon>
          退出登录
        </el-menu-item>
      </span>
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
        this.$router.push('/');
      });
    }
  }
}
</script>

<style>
.icon {
  border-radius: 5px;
  width: 40px;
  height: 40px;
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