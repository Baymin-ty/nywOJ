<template>
  <div class="reg">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          注册
        </div>
      </template>
      <el-form :model="userInfo">
        <el-form-item label="用户名" prop="name" style="margin-left: 15px">
          <el-input v-model="userInfo.name" type="text" placeholder="由字母或数字组成,长度在[3,15]之间" />
        </el-form-item>
        <el-form-item label="密码" prop="pass" style="margin-left: 28px">
          <el-input v-model="userInfo.pwd" type="password" placeholder="由字母或数字组成,长度在[6,31]之间" />
        </el-form-item>
        <el-form-item label="确认密码" prop="checkPass">
          <el-input v-model="userInfo.rePwd" type="password" />
        </el-form-item>
        <el-form-item label="人机验证" prop="pass">
          <div id="grecaptcha"></div>
        </el-form-item>
        <el-button type="primary" @click="submit" style="width: 250px;">注册</el-button>
      </el-form>
      <el-divider />
      <el-button type="info" plain @click="this.$router.push('/user/login')"
        style="width: 100%; height: 40px;">已有用户？点此登录</el-button>
    </el-card>
  </div>
</template>
<script>
import axios from "axios";
import { ElMessage } from "element-plus";

export default {
  name: "userReg",
  data() {
    return {
      userInfo: {
        name: "",
        pwd: "",
        rePwd: "",
      },
    }
  },
  methods: {
    submit(retoken) {
      axios.post('/api/user/reg', {
        name: this.userInfo.name,
        pwd: this.userInfo.pwd,
        rePwd: this.userInfo.rePwd,
        retoken: retoken,
      }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '注册成功',
            type: 'success',
            duration: 2000,
          });
          this.$router.push('/user/login');
        } else {
          window.grecaptcha.reset();
          ElMessage({
            message: res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
      }).catch(err => {
        ElMessage({
          message: err.message,
          type: 'error',
          duration: 2000,
        });
      });
    },
  },
  async mounted() {
    if (localStorage.getItem('isLogin')) {
      this.$router.push('/');
      return;
    }
    if (sessionStorage.getItem('path') !== '/user/reg') { // fix recaptcha
      sessionStorage.setItem('path', '/user/reg');
      location.reload();
    }
    await window.grecaptcha.render("grecaptcha", {
      sitekey: "6LcEKJIkAAAAAE2Xz-iJd3w_BW25txCZ0biX9CKU",
      callback: this.submit
    });
  }
}
</script>

<style scoped>
.reg {
  text-align: center;
  margin: 0 auto;
  max-width: 500px;
}

.card-header {
  font-weight: bold;
  font-size: 20px;
}
</style>