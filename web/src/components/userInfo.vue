<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1200px">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          个人主页
        </div>
      </template>
      <el-row>
        <el-col :span="12">
          <el-card style="width:90%; margin: auto; height: 600px;overflow-y: auto;" shadow="never">
            <template #header>
              <div class="card-header">
                个性签名
                <el-button v-show="info.uid === this.uid" type="success"
                  @click="this.dialogVisible = true">编辑我的个性签名</el-button>
                <el-dialog v-model="dialogVisible" title="编辑签名(会以html渲染)"
                  style="width:600px;height: 600px;border-radius: 10px" class="pd">
                  <el-divider />
                  <el-input v-model="newMotto" type="textarea" placeholder="Please input" :rows="20" :maxlength="200"
                    :show-word-limit="true" style="width:500px;margin: 20px;" resize="none" />
                  <el-button type="primary" @click="updateMotto">确认修改</el-button>
                </el-dialog>
              </div>
            </template>
            <div style="white-space: pre-wrap; text-align: left;" v-html="this.info.motto">
            </div>
          </el-card>
        </el-col>
        <el-col :span="12">
          <el-descriptions direction="vertical" :column="1" border>
            <el-descriptions-item label="uid"> {{ info.uid }}</el-descriptions-item>
            <el-descriptions-item label="用户名" :style="getNameStyle">{{ info.name }}</el-descriptions-item>
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
import store from "@/sto/store"
import { getNameColor } from "@/assets/common";

const fill = (x) => {
  x = x.toString();
  return x.length > 1 ? x : '0' + x;
}

const Format = (now) => {
  return now.getFullYear() + '-' + fill(now.getMonth() + 1) + '-' + fill(now.getDate()) + ' ' + fill(now.getHours()) + ':' + fill(now.getMinutes()) + ':' + fill(now.getSeconds());
}
export default {
  name: "userLogin",
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
          location.reload();
        } else {
          ElMessage({
            message: res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
      });
    },
    getNameStyle() {
      let style = {};
      style['textAlign'] = 'center';
      style['font-weight'] = 500;
      style['color'] = getNameColor(this.info.gid, this.info.clickCnt);
      if (style['color'] === '#8e44ad')
        style['font-weight'] = 900;
      console.log(style);
      return style;
    }
  },
  async mounted() {
    this.id = this.$route.params.id;
    this.uid = store.state.uid;
    await axios.post('/api/user/getUserPublicInfo', {
      id: this.id
    }).then((res) => {
      this.info = res.data.info;
      this.info.reg_time = Format(new Date(this.info.reg_time));
      this.info.login_time = Format(new Date(this.info.login_time));
      if (this.info.uid === this.uid) this.newMotto = this.info.motto;
      if (!this.info.motto) {
        this.info.motto = "Ta暂时没有设置个签噢"
      }
    });
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