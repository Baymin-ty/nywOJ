<template>
  <div class="login">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          登录
        </div>
      </template>
      <el-form :model="userInfo">
        <el-form-item label="用户名" prop="name" style="margin-left: 15px">
          <el-input v-model="userInfo.name" type="text" />
        </el-form-item>
        <el-form-item label="密码" prop="pass" style="margin-left: 28px">
          <el-input v-model="userInfo.pwd" type="password" @keyup.enter="submit" />
        </el-form-item>
        <el-button type="primary" @click="submit" style="width: 250px;">登录</el-button>
      </el-form>
      <el-divider />
      <el-button type="info" plain @click="this.$router.push('/user/reg')"
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
        name: "",
        pwd: "",
      },
    }
  },
  methods: {
    submit() {
      axios.post('/api/user/login', {
        name: this.userInfo.name,
        pwd: this.userInfo.pwd,
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('登录成功');
          this.$router.push(this.$store.state.reDirectTo);
          this.$store.state.reDirectTo = '/';
        } else {
          this.$message.error(res.data.message);
        }
      }).catch(err => {
        this.$message.error(err.message);
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
</style>