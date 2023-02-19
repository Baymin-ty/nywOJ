<template>
  <div class="reg">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          绑定邮箱
        </div>
      </template>
      <el-form :model="userInfo">
        <el-form-item label="邮箱" prop="name" style="margin-left: 27px">
          <el-input v-model="userInfo.email" type="text" placeholder="请先输入邮箱，再进行人机验证" />
        </el-form-item>
        <el-form-item label="人机验证" prop="pass">
          <div id="grecaptcha"></div>
        </el-form-item>
        <el-form-item label="验证码" prop="pass" style="margin-left: 13px">
          <el-input v-model="userInfo.vertifyCode" type="text" placeholder="通过上方人机验证后，自动发送验证码" />
        </el-form-item>
        <el-button type="primary" @click="submit" style="width: 250px;">提交</el-button>
      </el-form>
    </el-card>
  </div>
</template>

<script>
import axios from "axios";
import { ElMessage } from "element-plus";

export default {
  name: "userLogin",
  data() {
    return {
      userInfo: {
        email: "",
        vertifyCode: "",
      },
    }
  },
  methods: {
    sendVertifyCode(retoken) {
      axios.post('/api/user/sendEmailVertifyCode', {
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
        code: this.userInfo.vertifyCode
      }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '绑定成功',
            type: 'success',
            duration: 2000,
          });
          this.$router.push('/');
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
  },
  mounted() {
    setTimeout(() => {
      window.grecaptcha.render("grecaptcha", {
        sitekey: "6LcEKJIkAAAAAE2Xz-iJd3w_BW25txCZ0biX9CKU",
        callback: this.sendVertifyCode
      });
    }, 200);
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