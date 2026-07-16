<template>
  <div class="user-profile-edit">
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
          <el-form-item label="公开邮箱">
            <el-switch v-model="userInfo.publicEmail" active-text="公开" inactive-text="隐藏" />
          </el-form-item>
          <el-form-item label="昵称">
            <el-input v-model="userInfo.nickname" type="text" maxlength="24" show-word-limit />
          </el-form-item>
          <el-form-item label="一句话介绍">
            <el-input v-model="userInfo.bio" type="textarea" :rows="3" maxlength="160" show-word-limit resize="none" />
          </el-form-item>
          <el-form-item label="qq号">
            <el-input v-model="userInfo.qq" type="text" maxlength="30" show-word-limit @input="updateAvatarPreview" />
          </el-form-item>
          <el-form-item label="头像来源">
            <el-radio-group v-model="userInfo.avatarType" @change="changeAvatarType">
              <el-radio-button value="qq">QQ</el-radio-button>
              <el-radio-button value="github">GitHub</el-radio-button>
              <el-radio-button value="gravatar">Gravatar</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="头像账号">
            <el-input v-model="userInfo.avatarKey" type="text" maxlength="80" show-word-limit
              :placeholder="avatarPlaceholder" @input="updateAvatarPreview" />
          </el-form-item>
          <el-form-item label="组织">
            <el-input v-model="userInfo.organization" type="text" maxlength="80" show-word-limit />
          </el-form-item>
          <el-form-item label="所在地">
            <el-input v-model="userInfo.location" type="text" maxlength="80" show-word-limit />
          </el-form-item>
          <el-form-item label="个人网址">
            <el-input v-model="userInfo.homepageUrl" type="text" maxlength="80" show-word-limit placeholder="https://example.com" />
          </el-form-item>
          <el-form-item label="Telegram">
            <el-input v-model="userInfo.telegram" type="text" maxlength="30" show-word-limit placeholder="username" />
          </el-form-item>
          <el-form-item label="GitHub">
            <el-input v-model="userInfo.github" type="text" maxlength="30" show-word-limit placeholder="username" />
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
import { refreshUserInfo } from '@/assets/common'

export default {
  name: "userProfile",
  data() {
    return {
      userInfo: {},
      avatarAddress: '',
    }
  },
  methods: {
    parseAvatarInfo(value) {
      const raw = String(value || '');
      const pos = raw.indexOf(':');
      if (pos < 0) return { type: '', key: '' };
      return { type: raw.slice(0, pos), key: raw.slice(pos + 1) };
    },
    getAvatarAddress() {
      const type = this.userInfo.avatarType;
      const key = String(this.userInfo.avatarKey || '').trim();
      if (type === 'qq') {
        const qq = key || this.userInfo.qq;
        return qq ? `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(qq)}&s=5` : '/default-avatar.svg';
      }
      if (type === 'github') {
        const github = key || this.userInfo.github;
        return github ? `https://github.com/${encodeURIComponent(github)}.png?size=250` : '/default-avatar.svg';
      }
      if (type === 'gravatar' && /^[a-f0-9]{32}$/i.test(key)) {
        return `https://www.gravatar.com/avatar/${key}?s=250&d=404`;
      }
      return this.userInfo.avatar || '/default-avatar.svg';
    },
    updateAvatarPreview() {
      this.avatarAddress = this.getAvatarAddress();
    },
    changeAvatarType(type) {
      if (type === 'qq' && !this.userInfo.avatarKey) this.userInfo.avatarKey = this.userInfo.qq || '';
      if (type === 'github' && !this.userInfo.avatarKey) this.userInfo.avatarKey = this.userInfo.github || '';
      this.updateAvatarPreview();
    },
    submit() {
      this.userInfo.avatarInfo = `${this.userInfo.avatarType || 'qq'}:${this.userInfo.avatarKey || ''}`;
      axios.post('/api/user/updateUserPublicInfo', { userInfo: this.userInfo }).then(res => {
        if (res.status === 200) {
          this.$message.success('更新成功');
        } else {
          this.$message.error('更新失败' + res.data.message);
        }
        refreshUserInfo();
        this.all();
      });
    },
    all() {
      axios.post('/api/user/getUserPublicInfo', { uid: this.$store.state.uid }).then(res => {
        this.userInfo = res.data.info;
        for (const key of ['nickname', 'bio', 'organization', 'location', 'homepageUrl', 'telegram', 'github', 'qq', 'motto']) {
          if (this.userInfo[key] == null) this.userInfo[key] = '';
        }
        this.userInfo.publicEmail = !!this.userInfo.publicEmail;
        const avatar = this.parseAvatarInfo(this.userInfo.avatarInfo);
        this.userInfo.avatarType = ['qq', 'github', 'gravatar'].includes(avatar.type)
          ? avatar.type
          : (this.userInfo.qq ? 'qq' : 'gravatar');
        this.userInfo.avatarKey = avatar.key || (this.userInfo.avatarType === 'qq' ? this.userInfo.qq : '');
        this.updateAvatarPreview();
      });
    }
  },
  computed: {
    avatarPlaceholder() {
      if (this.userInfo.avatarType === 'github') return 'GitHub username';
      if (this.userInfo.avatarType === 'gravatar') return '邮箱或 32 位 MD5';
      return 'QQ number';
    },
  },
  mounted() {
    this.all();
  }
}
</script>

<style scoped>
.user-profile-edit {
  margin: 0 20px;
  min-width: 0;
}

.header {
  font-size: 24px;
  font-weight: 800;
}

.attach {
  font-size: 13px;
  font-weight: 500;
  color: rgba(0, 0, 0, .4);
}

@media (max-width: 768px) {
  .user-profile-edit {
    margin: 0;
  }

  :deep(.v-md-editor) {
    min-width: 0;
  }
}
</style>
