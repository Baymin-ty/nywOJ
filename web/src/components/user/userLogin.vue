<template>
  <div class="reg">
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
          <el-input v-model="userInfo.pwd" type="password" />
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
import store from "@/sto/store";
import axios from "axios";
import { ElMessage } from "element-plus";

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
          ElMessage({
            message: '登录成功',
            type: 'success',
            duration: 2000,
          });
          location.reload();
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
    if (store.state.uid) {
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