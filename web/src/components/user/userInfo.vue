<template>
  <div style="margin: 0 auto; max-width: 1500px;">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header" style="text-align: center;">
          个人主页
          <el-button v-show="info.uid === this.uid" type="success" @click="this.dialogVisible = true">
            <el-icon class="el-icon--left">
              <Edit />
            </el-icon>
            编辑个性签名
          </el-button>
          <el-dialog v-model="dialogVisible" title="编辑签名" style="width:600px;height: 600px;border-radius: 10px"
            class="pd">
            <el-divider />
            <el-input v-model="newMotto" type="textarea" placeholder="Please input" :rows="20" :maxlength="1000"
              :show-word-limit="true" style="width:500px;margin: 20px;" resize="none" />
            <el-button type="primary" @click="updateMotto">确认修改</el-button>
          </el-dialog>
        </div>
      </template>
      <el-row>
        <el-col :span="18">
          <el-card class="box-card" style="overflow-y: auto; height: 600px; margin: auto;" shadow="never">
            <v-md-preview :text="this.info.motto"></v-md-preview>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-descriptions direction="vertical" :column="1" border style="margin: 10px;">
            <el-descriptions-item label="uid"> {{ info.uid }}</el-descriptions-item>
            <el-descriptions-item label="用户名"> {{ info.name }}</el-descriptions-item>
            <el-descriptions-item label="电子邮件">{{ info.email }}</el-descriptions-item>
            <el-descriptions-item label="兔兔点击数">{{ info.clickCnt }}</el-descriptions-item>
            <el-descriptions-item label="用户角色">{{ group[info.gid] }}</el-descriptions-item>
            <el-descriptions-item label="登录时间">{{ info.login_time }}</el-descriptions-item>
            <el-descriptions-item label="注册时间">{{ info.reg_time }}</el-descriptions-item>
          </el-descriptions>
        </el-col>
      </el-row>
    </el-card>
  </div>
</template>

<script>
import axios from "axios";
import { ElMessage } from "element-plus";

export default {
  name: "userInfo",
  data() {
    return {
      uid: 0,
      id: 0,
      dialogVisible: false,
      info: {},
      newMotto: '/',
      group: ['', '普通用户', '管理员', '超级管理员'],
    }
  },
  methods: {
    updateMotto() {
      axios.post('/api/user/setUserMotto', {
        data: this.newMotto
      }).then((res) => {
        if (res.status === 200) {
          ElMessage({
            message: '更新个签成功',
            type: 'success',
            duration: 1000,
          });
          this.dialogVisible = false;
          this.all();
        } else {
          ElMessage({
            message: res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
      });
    },
    all() {
      axios.post('/api/user/getUserPublicInfo', {
        id: this.id
      }).then((res) => {
        if (res.data.info) {
          this.info = res.data.info;
          if (this.info.uid === this.uid) this.newMotto = this.info.motto;
          if (!this.info.motto) {
            this.info.motto = "Ta暂时没有设置个签噢"
          }
        }
        else {
          this.$router.go(-1);
        }
      });
    }
  },
  async mounted() {
    this.id = this.$route.params.uid;
    this.uid = this.$store.state.uid;
    await this.all();
  }
}
</script>

<style scoped>
.box-card {
  height: 700px;
  margin: 10px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
}
</style>