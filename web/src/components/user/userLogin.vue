<template>
  <div class="login">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          登录
        </div>
      </template>
      <el-tabs v-model="loginMode" stretch>
        <el-tab-pane label="密码登录" name="password">
          <el-form :model="userInfo">
            <el-form-item label="账号" style="margin-left: 28px">
              <el-input v-model="userInfo.account" type="text" placeholder="用户名 / 邮箱" />
            </el-form-item>
            <el-form-item label="密码" style="margin-left: 28px">
              <el-input v-model="userInfo.pwd" type="password" @keyup.enter="submitPassword" />
            </el-form-item>
            <el-button type="primary" :loading="loggingIn" @click="submitPassword" style="width: 250px;">登录</el-button>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="邮箱验证码" name="emailCode">
          <el-form :model="emailLogin">
            <el-form-item label="邮箱" style="margin-left: 28px">
              <el-input v-model="emailLogin.email" type="text" placeholder="绑定账号的邮箱" />
            </el-form-item>
            <el-form-item label="验证码" style="margin-left: 14px">
              <el-input v-model="emailLogin.code" type="text" @keyup.enter="submitEmailCode">
                <template #append>
                  <el-button :loading="sendingCode" @click="sendEmailCode">发送</el-button>
                </template>
              </el-input>
            </el-form-item>
            <el-button type="primary" :loading="loggingIn" @click="submitEmailCode" style="width: 250px;">登录</el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>
      <div class="forgot-link" @click="$router.push('/user/forgot')">忘记密码？通过邮箱找回</div>
      <el-divider />
      <el-button type="info" plain @click="$router.push('/user/reg')"
        style="width: 100%; height: 40px;">新用户？点此注册</el-button>
    </el-card>
  </div>
</template>

<script>
import axios from "axios";

export default {
  name: "userLogin",
  data() {
    return {
      userInfo: {
        account: "",
        pwd: "",
      },
      emailLogin: {
        email: "",
        code: "",
      },
      loginMode: 'password',
      sendingCode: false,
      loggingIn: false,
    }
  },
  methods: {
    onLoginSuccess() {
      this.$message.success('登录成功');
      this.$router.push(this.$store.state.reDirectTo);
      this.$store.state.reDirectTo = '/';
    },
    submitPassword() {
      this.loggingIn = true;
      axios.post('/api/user/login', {
        name: this.userInfo.account,
        pwd: this.userInfo.pwd,
      }).then(res => {
        if (res.status === 200) {
          this.onLoginSuccess();
        } else {
          this.$message.error(res.data.message);
        }
      }).catch(err => {
        this.$message.error(err.message);
      }).finally(() => {
        this.loggingIn = false;
      });
    },
    sendEmailCode() {
      this.sendingCode = true;
      axios.post('/api/user/sendLoginEmailCode', {
        email: this.emailLogin.email,
      }).then(res => {
        if (res.status === 200) {
          this.$message.success(res.data.message || '验证码已发送，请注意查收');
        } else {
          this.$message.error(res.data.message);
        }
      }).catch(err => {
        this.$message.error(err.message);
      }).finally(() => {
        this.sendingCode = false;
      });
    },
    submitEmailCode() {
      this.loggingIn = true;
      axios.post('/api/user/loginByEmailCode', {
        code: this.emailLogin.code,
      }).then(res => {
        if (res.status === 200) {
          this.onLoginSuccess();
        } else {
          this.$message.error(res.data.message);
        }
      }).catch(err => {
        this.$message.error(err.message);
      }).finally(() => {
        this.loggingIn = false;
      });
    },
  },
  mounted() {
    if (this.$store.state.uid) {
      this.$router.push('/');
      return;
    }
  }
}
</script>

<style scoped>
.login {
  text-align: center;
  margin: 0 auto;
  max-width: 500px;
}

.card-header {
  font-weight: bold;
  font-size: 20px;
}

.forgot-link {
  margin-top: 12px;
  font-size: 13px;
  color: #409EFF;
  cursor: pointer;
}

.forgot-link:hover {
  text-decoration: underline;
}
</style>
