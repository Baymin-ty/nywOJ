<template>
  <div style="margin: 0 20px;">
    <div class="header">
      修改密码
    </div>
    <el-divider />
    <el-col :span="12">
      <el-form label-position="top">
        <el-form-item label="旧密码">
          <el-input v-model="updPwd.old" type="password" />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="updPwd.new" type="password" placeholder="长度在 6~31 之间" />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="updPwd.rep" type="password" />
        </el-form-item>
      </el-form>
      <el-button type="primary" @click="updatedPwd">提交</el-button>
    </el-col>
    <div class="header" style="margin-top: 20px;">
      修改邮箱
    </div>
    <el-divider />
    <el-col :span="12">
      <el-form label-position="top">
        <el-form-item label="新邮箱">
          <el-input v-model="updEmail.new" type="text" placeholder="请先输入邮箱，再进行人机验证" />
        </el-form-item>
        <el-form-item label="人机验证">
          <el-button type="info" plain v-show="!recap" @click="recaptcha">发送验证码</el-button>
          <div id="grecaptcha" v-show="recap"></div>
        </el-form-item>
        <el-form-item label="验证码">
          <el-input v-model="updEmail.verifyCode" type="text" placeholder="通过上方人机验证后，自动发送验证码" />
        </el-form-item>
        <el-button type="primary" @click="updateEmail">提交</el-button>
      </el-form>
    </el-col>
  </div>
</template>

<script>
import axios from "axios";
import { ElMessage } from "element-plus";

export default {
  name: "userSecurity",
  data() {
    return {
      updPwd: {
        old: '',
        new: '',
        rep: ''
      },
      updEmail: {
        new: '',
        verifyCode: ''
      },
      recap: 0
    }
  },
  methods: {
    updatedPwd() {
      axios.post('/api/user/modifyPassword', { newPwd: this.updPwd }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '更新成功',
            type: 'success',
            duration: 1000,
          });
        } else {
          ElMessage({
            message: '更新失败' + res.data.message,
            type: 'error',
            duration: 3000,
          });
        }
        this.all();
      });
    },
    sendVerifyCode(retoken) {
      axios.post('/api/user/sendEmailVerifyCode', {
        email: this.updEmail.new,
        retoken: retoken,
        update: true
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
    updateEmail() {
      axios.post('/api/user/setUserEmail', {
        code: this.updEmail.verifyCode,
        update: true
      }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: res.data.message,
            type: 'success',
            duration: 2000,
          });
          this.updEmail = {
            new: '',
            verifyCode: ''
          };
          if (this.recap)
            window.grecaptcha.reset();
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
  mounted() {

  }
}
</script>

<style scoped>
.header {
  font-size: 24px;
  font-weight: 800;
}
</style>