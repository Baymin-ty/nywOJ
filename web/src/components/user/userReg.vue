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
      <el-form :model="userInfo" v-show="!active">
        <el-form-item label="邮箱" prop="name" style="margin-left: 27px">
          <el-input v-model="userInfo.email" type="text" placeholder="请输入邮箱"
            @blur="checkEmailAvailability(false)" />
          <div v-if="availability.email.text" :class="['availability', availability.email.type]">
            {{ availability.email.text }}
          </div>
        </el-form-item>
        <el-form-item label="邮箱验证" prop="pass">
          <el-button type="info" plain @click="sendVerifyCode">发送验证码</el-button>
        </el-form-item>
        <el-form-item label="验证码" prop="pass" style="margin-left: 13px">
          <el-input v-model="userInfo.verifyCode" type="text" placeholder="请输入邮箱验证码" />
        </el-form-item>
        <el-button type="primary" @click="submit" style="width: 250px;">验证</el-button>
      </el-form>

      <el-form :model="userInfo" v-show="active">
        <el-form-item label="用户名" prop="name" style="margin-left: 15px">
          <el-input v-model="userInfo.name" type="text" placeholder="3~24 位，可包含字母、数字和 -_.#$"
            @blur="checkUsernameAvailability(false)" />
          <div v-if="availability.username.text" :class="['availability', availability.username.type]">
            {{ availability.username.text }}
          </div>
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

export default {
  name: "userReg",
  data() {
    return {
      active: 0,
      userInfo: {
        name: "",
        pwd: "",
        rePwd: "",
      },
      availability: {
        email: { type: '', text: '' },
        username: { type: '', text: '' },
      },
    }
  },
  methods: {
    async checkEmailAvailability(showMessage) {
      const email = String(this.userInfo.email || '').trim();
      this.availability.email = { type: '', text: '' };
      if (!email) {
        if (showMessage) this.$message.error('请先填写邮箱');
        return false;
      }
      try {
        const res = await axios.post('/api/user/checkAvailability', { email });
        if (res.data.emailAvailable) {
          this.availability.email = { type: 'ok', text: '邮箱可用' };
          return true;
        }
        this.availability.email = { type: 'error', text: '邮箱格式错误或已被使用' };
        if (showMessage) this.$message.error(this.availability.email.text);
      } catch (err) {
        if (showMessage) this.$message.error(err.message);
      }
      return false;
    },
    async checkUsernameAvailability(showMessage) {
      const username = String(this.userInfo.name || '').trim();
      this.availability.username = { type: '', text: '' };
      if (!username) {
        if (showMessage) this.$message.error('请先填写用户名');
        return false;
      }
      try {
        const res = await axios.post('/api/user/checkAvailability', { username });
        if (res.data.usernameAvailable) {
          this.availability.username = { type: 'ok', text: '用户名可用' };
          return true;
        }
        this.availability.username = { type: 'error', text: '用户名格式错误或已被注册' };
        if (showMessage) this.$message.error(this.availability.username.text);
      } catch (err) {
        if (showMessage) this.$message.error(err.message);
      }
      return false;
    },
    async sendVerifyCode() {
      if (!(await this.checkEmailAvailability(true))) return;
      axios.post('/api/user/sendEmailVerifyCode', {
        email: this.userInfo.email,
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('验证码已发送，请注意查收');
        } else this.$message.error(JSON.stringify(res.data.message));
      }).catch(err => {
        this.$message.error(err.message);
      });
    },
    submit() {
      axios.post('/api/user/setUserEmail', {
        code: this.userInfo.verifyCode
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('验证成功');
          this.active++;
        } else {
          this.$message.error(res.data.message);
        }
      }).catch(err => {
        this.$message.error(err.message);
      });
    },
    async reg() {
      if (!(await this.checkUsernameAvailability(true))) return;
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

.availability {
  margin-top: 4px;
  text-align: left;
  font-size: 12px;
  line-height: 1.4;
}

.availability.ok {
  color: #67c23a;
}

.availability.error {
  color: #f56c6c;
}
</style>
