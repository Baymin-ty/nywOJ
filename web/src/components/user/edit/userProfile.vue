<template>
  <div class="profile-wrap">
    <el-row :gutter="24">
      <el-col :xs="24" :sm="16">
        <div class="section-title">个人信息</div>
        <el-divider />
        <el-form label-position="top" class="profile-form">
          <el-form-item label="用户名">
            <el-input v-model="userInfo.name" disabled />
            <span class="attach">请联系超级管理员修改用户名</span>
          </el-form-item>
          <el-form-item label="邮箱">
            <el-input v-model="userInfo.email" disabled />
            <span class="attach">请在「账号安全」中修改邮箱</span>
          </el-form-item>
          <el-form-item label="偏好语言">
            <el-select v-model="userInfo.preferenceLang" placeholder="选择语言" style="width:100%">
              <el-option v-for="l in $store.state.langList" :key="l.id" :label="l.des" :value="l.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="QQ 号">
            <el-input v-model="userInfo.qq" placeholder="输入 QQ 号，头像将同步" />
            <span class="attach">OJ 头像将使用 QQ 头像</span>
          </el-form-item>
          <el-form-item label="个人主页">
            <el-input
              v-model="userInfo.motto"
              type="textarea"
              :rows="8"
              :maxlength="1000"
              show-word-limit
              resize="none"
              placeholder="写点什么介绍自己…"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="submit">保存修改</el-button>
          </el-form-item>
        </el-form>
      </el-col>

      <el-col :xs="24" :sm="8">
        <div class="avatar-col">
          <el-avatar shape="square" :size="180" :src="avatarAddress" class="avatar-img" />
          <p class="attach" style="text-align:center; margin-top:10px">
            填写 QQ 号后自动同步头像
          </p>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script>
import axios from "axios";
import { refreshUserInfo } from '@/assets/common';

export default {
  name: "userProfile",
  data() {
    return { userInfo: {}, avatarAddress: '/default-avatar.svg' };
  },
  methods: {
    getAvatarAddress(qq) {
      if (!qq || !qq.length) return '/default-avatar.svg';
      return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=5`;
    },
    submit() {
      axios.post('/api/user/updateUserPublicInfo', { userInfo: this.userInfo }).then(res => {
        if (res.status === 200) this.$message.success('更新成功');
        else this.$message.error('更新失败 ' + res.data.message);
        refreshUserInfo();
        this.all();
      });
    },
    all() {
      axios.post('/api/user/getUserPublicInfo', { uid: this.$store.state.uid }).then(res => {
        this.userInfo = res.data.info;
        this.avatarAddress = this.getAvatarAddress(this.userInfo.qq);
      });
    },
  },
  watch: {
    'userInfo.qq'(val) {
      this.avatarAddress = this.getAvatarAddress(val);
    },
  },
  mounted() { this.all(); },
};
</script>

<style scoped>
.profile-wrap { margin: 0 20px; padding-bottom: 24px; }

.section-title {
  font-size: 22px;
  font-weight: 800;
  color: #2c3e50;
}

.profile-form { margin-top: 8px; }

.attach {
  font-size: 12px;
  font-weight: 500;
  color: rgba(0,0,0,.4);
  display: block;
  margin-top: 4px;
}

.avatar-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 48px;
}

.avatar-img {
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.1);
}

@media (max-width: 576px) {
  .profile-wrap { margin: 0 12px; }
  .avatar-col { padding-top: 12px; }
}
</style>
