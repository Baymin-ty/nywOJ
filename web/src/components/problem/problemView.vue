<template>
  <el-row style="margin: auto;width: 1500px;">
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
            题目信息
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
        <el-button type="primary">提交代码</el-button>
        <el-button v-show="this.gid > 1" type="danger"
          @click="this.$router.push('/problem/edit/' + problemInfo.pid)">题目管理</el-button>
      </el-card>
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios';
import store from '@/sto/store';

export default {
  name: "problemView",
  data() {
    return {
      gid: 1,
      problemInfo: [],
    }
  },
  async mounted() {
    this.pid = this.$route.params.pid;
    this.gid = store.state.gid;
    await axios.post('/api/problem/getProblemInfo', { pid: this.pid }).then(res => {
      this.problemInfo = res.data.data
      this.problemInfo.isPublic = res.data.data.isPublic ? true : false;
    });
  }
}
</script>

<style scoped>
.box-card {
  margin: 10px;
  text-align: left;
}

.box-card {
  margin: 10px;
}

.title {
  text-align: center;
  margin: 0;
  font-size: 30px;
}
</style>