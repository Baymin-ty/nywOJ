<template>
  <div class="user-security-edit">
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
          <el-input v-model="updEmail.new" type="text" placeholder="请输入新邮箱" />
        </el-form-item>
        <el-form-item label="邮箱验证">
          <el-button type="info" plain @click="sendVerifyCode">发送验证码</el-button>
        </el-form-item>
        <el-form-item label="验证码">
          <el-input v-model="updEmail.verifyCode" type="text" placeholder="请输入邮箱验证码" />
        </el-form-item>
        <el-button type="primary" @click="updateEmail">提交</el-button>
      </el-form>
    </el-col>
  </div>
</template>

<script>
import axios from "axios";

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
      }
    }
  },
  methods: {
    updatedPwd() {
      axios.post('/api/user/modifyPassword', { newPwd: this.updPwd }).then(res => {
        if (res.status === 200) {
          this.$message.success('更新成功');
          this.updPwd = { old: '', new: '', rep: '' };
        }
      }).catch(err => {
        this.$message.error((err.response && err.response.data && err.response.data.message) || err.message || '更新失败');
      });
    },
    sendVerifyCode() {
      axios.post('/api/user/sendEmailVerifyCode', {
        email: this.updEmail.new,
        update: true
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('验证码已发送，请注意查收');
        } else this.$message.error(res.data.message);
      }).catch(err => {
        this.$message.error(err.message);
      });
    },
    updateEmail() {
      axios.post('/api/user/setUserEmail', {
        code: this.updEmail.verifyCode,
        update: true
      }).then(res => {
        if (res.status === 200) {
          this.$message.success(res.data.message);
          this.updEmail = {
            new: '',
            verifyCode: ''
          };
        } else this.$message.error(res.data.message);
      }).catch(err => {
        this.$message.error(err.message);
      });
    }
  }
}
</script>

<style scoped>
.user-security-edit {
  margin: 0 20px;
  min-width: 0;
}

.header {
  font-size: 24px;
  font-weight: 800;
}

@media (max-width: 768px) {
  .user-security-edit {
    margin: 0;
  }
}
</style>
