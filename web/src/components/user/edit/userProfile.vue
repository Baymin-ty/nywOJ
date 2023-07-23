<template>
  <div style="margin: 0 20px;">
    <el-row>
      <el-col :span="16">
        <div class="header">
          个人信息
        </div>
        <el-divider />
        <el-form label-position="top">
          <el-form-item label="用户名">
            <el-input v-model="userInfo.name" type="text" :disabled="true" />
            <span class="attach">请联系超级管理员修改用户名</span>
          </el-form-item>
          <el-form-item label="邮箱">
            <el-input v-model="userInfo.email" type="text" :disabled="true" />
            <span class="attach">请在「账号安全」中修改邮箱</span>
          </el-form-item>
          <el-form-item label="qq号">
            <el-input v-model="userInfo.qq" type="text" />
            <span class="attach">OJ头像将使用qq头像</span>
          </el-form-item>
          <el-form-item label="个人主页">
            <el-input v-model="userInfo.motto" type="textarea" :rows="10" :maxlength="1000" :show-word-limit="true"
              resize="none" />
          </el-form-item>
        </el-form>
        <el-button type="primary" @click="submit">提交</el-button>
      </el-col>
      <el-col :span="8">
        <div style="margin: 0 20px;">
          <el-avatar shape="square" :size="250" :src="avatarAddress" />
        </div>
      </el-col>
    </el-row>
  </div>
</template>
<script>
import axios from "axios";
import { ElMessage } from "element-plus";

export default {
  name: "userProfile",
  data() {
    return {
      userInfo: {},
      avatarAddress: '',
    }
  },
  methods: {
    getAvatarAddress(qq) {
      if (!qq || !qq.length) return 'https://cdn.ty.szsyzx.cn/default-avatar.svg';
      return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=5`;
    },
    submit() {
      axios.post('/api/user/updateUserPublicInfo', { userInfo: this.userInfo }).then(res => {
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
    all() {
      axios.post('/api/user/getUserPublicInfo', { uid: this.$store.state.uid }).then(res => {
        this.userInfo = res.data.info;
        this.avatarAddress = this.getAvatarAddress(this.userInfo.qq);
      })
    }
  },
  mounted() {
    this.all();
  }
}
</script>

<style scoped>
.header {
  font-size: 24px;
  font-weight: 800;
}

.attach {
  font-size: 13px;
  font-weight: 500;
  color: rgba(0, 0, 0, .4);
}
</style>