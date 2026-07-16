<template>
  <div class="forgot">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">找回密码</div>
      </template>

      <el-steps :active="active" finish-status="success" simple style="margin-bottom: 20px;">
        <el-step title="邮箱验证" />
        <el-step title="重置密码" />
      </el-steps>

      <el-form v-show="active === 0" :model="form">
        <el-form-item label="邮箱" style="margin-left: 27px">
          <el-input v-model="form.email" type="text" placeholder="请输入绑定账号的邮箱" />
        </el-form-item>
        <el-button type="primary" :loading="sending" @click="sendCode" style="width: 250px;">发送验证码</el-button>
      </el-form>

      <el-form v-show="active === 1" :model="form">
        <el-form-item label="邮箱" style="margin-left: 27px">
          <el-input v-model="form.email" type="text" disabled />
        </el-form-item>
        <el-form-item label="验证码" style="margin-left: 13px">
          <el-input v-model="form.code" type="text" placeholder="请输入邮箱验证码" />
        </el-form-item>
        <el-form-item label="新密码" style="margin-left: 14px">
          <el-input v-model="form.pwd" type="password" placeholder="长度在 6~31 之间" />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="form.rePwd" type="password" @keyup.enter="resetPassword" />
        </el-form-item>
        <el-button type="primary" :loading="resetting" @click="resetPassword" style="width: 250px;">重置密码</el-button>
        <el-button plain @click="active = 0" style="width: 250px; margin: 10px 0 0 0;">重新填写邮箱</el-button>
      </el-form>

      <el-divider />
      <el-button type="info" plain @click="$router.push('/user/login')"
        style="width: 100%; height: 40px;">返回登录</el-button>
    </el-card>
  </div>
</template>

<script>
import axios from "axios";

export default {
  name: "userForgotPassword",
  data() {
    return {
      active: 0,
      sending: false,
      resetting: false,
      form: {
        email: "",
        code: "",
        pwd: "",
        rePwd: "",
      },
    }
  },
  methods: {
    sendCode() {
      this.sending = true;
      axios.post('/api/user/sendPasswordResetCode', {
        email: this.form.email,
      }).then(res => {
        if (res.status === 200) {
          this.$message.success(res.data.message || '验证码已发送，请注意查收');
          this.active = 1;
        } else {
          this.$message.error(res.data.message);
        }
      }).catch(err => {
        this.$message.error(err.message);
      }).finally(() => {
        this.sending = false;
      });
    },
    resetPassword() {
      this.resetting = true;
      axios.post('/api/user/resetPasswordByEmail', {
        code: this.form.code,
        pwd: this.form.pwd,
        rePwd: this.form.rePwd,
      }).then(res => {
        if (res.status === 200) {
          this.$message.success(res.data.message || '密码已重置');
          this.$router.push('/user/login');
        } else {
          this.$message.error(res.data.message);
        }
      }).catch(err => {
        this.$message.error(err.message);
      }).finally(() => {
        this.resetting = false;
      });
    },
  },
  mounted() {
    if (this.$store.state.uid) {
      this.$router.push('/');
    }
  }
}
</script>

<style scoped>
.forgot {
  text-align: center;
  margin: 0 auto;
  max-width: 500px;
}

.card-header {
  font-weight: bold;
  font-size: 20px;
}

@media (max-width: 768px) {
  .forgot {
    width: 100%;
  }

  :deep(.el-card__body) {
    padding-inline: 14px;
  }

  :deep(.el-steps--simple) {
    padding: 10px;
  }

  :deep(.el-step__title) {
    font-size: 13px !important;
  }

  :deep(.el-form-item) {
    margin-left: 0 !important;
  }

  :deep(.el-form-item__content) {
    min-width: 0;
  }

  :deep(.el-button[style*="width: 250px"]) {
    width: 100% !important;
    max-width: 250px;
  }
}
</style>
