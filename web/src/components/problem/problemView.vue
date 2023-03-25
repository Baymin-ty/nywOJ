<template>
  <el-row style="margin: auto;max-width: 1500px;min-width: 600px;">
    <el-col :span="16">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <p class="title">#{{ problemInfo.pid }}、{{ problemInfo.title }}</p>
          </div>
        </template>
        <v-md-preview :text="problemInfo.description"> </v-md-preview>
      </el-card>
    </el-col>
    <el-col :span="8">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            题目信息 (提交: {{ problemInfo.submitCnt }} AC: {{ problemInfo.acCnt }})
          </div>
        </template>
        <el-descriptions direction="vertical" :column="1" border>
          <el-descriptions-item label="时间限制"> {{ problemInfo.timeLimit }} ms</el-descriptions-item>
          <el-descriptions-item label="空间限制"> {{ problemInfo.memoryLimit }} MB</el-descriptions-item>
          <el-descriptions-item label="出题人">
            <span style="cursor: pointer;" @click="this.$router.push('/user/' + problemInfo.publisherUid)"> {{
              problemInfo.publisher
            }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="发布时间"> {{ problemInfo.time }} </el-descriptions-item>
          <el-descriptions-item label="是否公开">
            <el-switch v-model="problemInfo.isPublic" disabled size="large" active-text="公开" inactive-text="隐藏" />
          </el-descriptions-item>
        </el-descriptions>
        <el-divider style="margin-top: 20px; margin-bottom: 20px;" />
        <div style="text-align: center;">
          <el-button type="primary" @click="this.dialogVisible = true">提交代码</el-button>
          <el-button v-show="this.gid > 1" type="danger"
            @click="this.$router.push('/problem/edit/' + problemInfo.pid)">题目管理</el-button>
        </div>
      </el-card>
      <el-dialog :lock-scroll="false" v-model="dialogVisible" title="提交代码"
        style="width:1000px;height: 600px;border-radius: 10px; text-align: center;">
        <el-input v-model="code" type="textarea" :rows="20" resize="none" />
        <el-divider style="margin-top: 10px; margin-bottom: 10px;" />
        <el-button type="primary" @click="submit" style="margin: 10px;">确认提交</el-button>
      </el-dialog>
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios';
import { ElMessage } from 'element-plus'
import store from '@/sto/store';

export default {
  name: "problemView",
  data() {
    return {
      pid: 0,
      gid: 1,
      dialogVisible: false,
      problemInfo: {},
      code: '',
    }
  },
  methods: {
    submit() {
      axios.post('/api/judge/submit', {
        pid: this.pid,
        code: this.code
      }).then(res => {
        if (res.status === 200) {
          this.$router.push('/submission/' + res.data.sid);
        } else {
          ElMessage({
            message: '提交失败' + res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
      });
    }
  },
  async mounted() {
    this.pid = this.$route.params.pid;
    this.gid = store.state.gid;
    await axios.post('/api/problem/getProblemInfo', { pid: this.pid }).then(res => {
      if (res.status === 200) {
        this.problemInfo = res.data.data
        this.problemInfo.isPublic = res.data.data.isPublic ? true : false;
      }
      else {
        this.$router.go(-1);
      }
    });
    document.title = "题目 — " + this.problemInfo.title;
  }
}
</script>

<style scoped>
.box-card {
  margin: 10px;
  text-align: left;
}

.title {
  text-align: center;
  margin: 0;
  font-size: 25px;
}
</style>