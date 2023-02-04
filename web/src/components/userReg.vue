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
          <el-input v-model="userInfo.name" type="text"/>
        </el-form-item>
        <el-form-item label="密码" prop="pass" style="margin-left: 28px">
          <el-input v-model="userInfo.pwd" type="password"/>
        </el-form-item>
        <el-form-item label="确认密码" prop="checkPass">
          <el-input v-model="userInfo.rePwd" type="password"/>
        </el-form-item>
        <el-button type="primary" @click="submit">提交</el-button>
      </el-form>
    </el-card>
  </div>
</template>
<script>
import axios from "axios";
import {ElMessage} from "element-plus";

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
    submit() {
      axios.get('/user/reg', {
        params: {
          name: this.userInfo.name,
          pwd: this.userInfo.pwd,
          rePwd: this.userInfo.rePwd,
        }
      }).then(res => {
        if (res.data.status === 200) {
          ElMessage({
            message: '注册成功',
            type: 'success',
            duration: 2000,
          });
          this.$router.push('/user/login');
        } else {
          let err = res.data.message;
          if (res.data.status === 250)
            err = "此用户名已被注册";
          ElMessage({
            message: err,
            type: 'error',
          });
        }
      }).catch(err => {
        ElMessage({
          message: err.message,
          type: 'error',
          duration: 2000,
        });
        this.finished = 1;
      });
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