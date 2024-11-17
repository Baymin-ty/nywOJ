<template>
  <div class="reg">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          注册
        </div>
      </template>
      <el-steps :active="active" finish-status="success" simple style="margin-bottom: 20px;">
        <el-step title="绑定邮箱" />
        <el-step title="个人信息" />
      </el-steps>
      <el-form :model="emailInfo" v-show="!active">
        <el-form-item label="邮箱" prop="name" style="margin-left: 27px">
          <el-input v-model="userInfo.email" type="text" placeholder="请先输入邮箱，再进行人机验证" />
        </el-form-item>
        <el-form-item label="人机验证" prop="pass">
          <el-button type="info" plain v-show="!recap" @click="recaptcha">发送验证码</el-button>
          <div id="grecaptcha" v-show="recap"></div>
        </el-form-item>
        <el-form-item label="验证码" prop="pass" style="margin-left: 13px">
          <el-input v-model="userInfo.verifyCode" type="text" placeholder="通过上方人机验证后，自动发送验证码" />
        </el-form-item>
        <el-button type="primary" @click="submit" style="width: 250px;">验证</el-button>
      </el-form>

      <el-form :model="userInfo" v-show="active">
        <el-form-item label="用户名" prop="name" style="margin-left: 15px">
          <el-input v-model="userInfo.name" type="text" placeholder="由字母或数字组成,长度在 3~15 之间" />
        </el-form-item>
        <el-form-item label="密码" prop="pass" style="margin-left: 28px">
          <el-input v-model="userInfo.pwd" type="password" placeholder="长度在 6~31 之间" />
        </el-form-item>
        <el-form-item label="确认密码" prop="checkPass">
          <el-input v-model="userInfo.rePwd" type="password" />
        </el-form-item>
        <el-button type="primary" @click="reg" style="width: 250px;">注册</el-button>
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
      active: 0,
      recap: 0,
      userInfo: {
        name: "",
        pwd: "",
        rePwd: "",
      },
      emailInfo: {
        email: "",
        verifyCode: "",
      },
    }
  },
  methods: {
    sendVerifyCode(retoken) {
      axios.post('/api/user/sendEmailVerifyCode', {
        email: this.userInfo.email,
        retoken: retoken,
      }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '验证码已发送，请注意查收',
            type: 'success',
            duration: 2000,
          });
        } else {
          if (this.recap)
            window.grecaptcha.reset();
          ElMessage({
            message: res.data.message,
            type: 'error',
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
    submit() {
      axios.post('/api/user/setUserEmail', {
        code: this.userInfo.verifyCode
      }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '验证成功',
            type: 'success',
            duration: 2000,
          });
          this.active++;
        } else {
          ElMessage({
            message: res.data.message,
            type: 'error',
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
    reg() {
      axios.post('/api/user/reg', {
        name: this.userInfo.name,
        pwd: this.userInfo.pwd,
        rePwd: this.userInfo.rePwd,
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('注册成功');
          this.$router.push('/user/login');
        } else {
          this.$message.error(res.data.message);
        }
      }).catch(err => {
        this.$message.error(err.message);
      });
    },
    recaptcha() {
      this.sendVerifyCode();
      return;

      // if (this.recap) return;
      // this.recap = 1;
      // window.grecaptcha.render("grecaptcha", {
      //   sitekey: "6LcEKJIkAAAAAE2Xz-iJd3w_BW25txCZ0biX9CKU",
      //   callback: this.sendVerifyCode
      // });
    }
  },
  async mounted() {
    if (this.$store.state.uid) {
      this.$router.push('/');
      return;
    }
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