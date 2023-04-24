<template>
  <el-row style="margin: auto;max-width: 1500px;min-width: 600px;">
    <el-col :span="18">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <p class="title">T{{ problemInfo.idx }}、{{ problemInfo.title }}</p>
          </div>
        </template>
        <v-md-preview :text="problemInfo.description"> </v-md-preview>
      </el-card>
    </el-col>
    <el-col :span="6">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            题目信息
          </div>
        </template>
        <el-descriptions direction="vertical" :column="1" border>
          <el-descriptions-item label="时间限制"> {{ problemInfo.timeLimit }} ms</el-descriptions-item>
          <el-descriptions-item label="空间限制"> {{ problemInfo.memoryLimit }} MB</el-descriptions-item>
          <el-descriptions-item label="题目类型"> {{ problemInfo.type }} </el-descriptions-item>
          <el-descriptions-item label=" 出题人">
            <span class="rlink" @click="this.$router.push('/user/' + problemInfo.publisherUid)"> {{
              problemInfo.publisher
            }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="发布时间"> {{ problemInfo.time }} </el-descriptions-item>
        </el-descriptions>
        <el-divider style="margin-top: 20px; margin-bottom: 20px;" />
        <div style="text-align: center;">
          <el-button type="primary" @click="this.dialogVisible = true">
            <el-icon class="el-icon--left">
              <Upload />
            </el-icon>
            提交代码
          </el-button>
          <el-button type="success" @click="
            this.$router.push({
              path: '/contest/' + this.cid,
              query: {
                tab: 'problem'
              }
            })">
            <el-icon class="el-icon--left">
              <RefreshLeft />
            </el-icon>
            返回比赛
          </el-button>
        </div>
      </el-card>
      <el-dialog v-model="dialogVisible" title="提交代码" style="width:1000px;border-radius: 5px; text-align: center;"
        class="pd">
        <el-divider />
        <el-input v-model="code" type="textarea" :rows="20" resize="none" style=" padding: 10px; width: 950px;" />
        <el-divider />
        <el-button type="primary" @click="submit" style="margin-top: 10px;margin-bottom: 20px;">确认提交</el-button>
      </el-dialog>
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios';
import { ElMessage } from 'element-plus'

export default {
  name: "contestProblemView",
  data() {
    return {
      cid: 0,
      pid: 0,
      gid: 1,
      dialogVisible: false,
      problemInfo: {},
      code: "",
    };
  },
  methods: {
    submit() {
      axios.post("/api/contest/submit", {
        cid: this.cid,
        idx: this.idx,
        code: this.code
      }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: "提交成功",
            type: "success",
            duration: 1000,
          });
          this.dialogVisible = false;
          this.code = '';
        }
        else {
          ElMessage({
            message: "提交失败" + res.data.message,
            type: "error",
            duration: 2000,
          });
        }
      });
    }
  },
  async mounted() {
    this.cid = this.$route.params.cid;
    this.idx = this.$route.params.idx;
    this.gid = this.$store.state.gid;
    await axios.post("/api/contest/getProblemInfo", { cid: this.cid, idx: this.idx }).then(res => {
      if (res.status === 200) {
        this.problemInfo = res.data.data;
      }
      else {
        this.$router.go(-1);
      }
    });
    document.title = "比赛题目 — " + this.problemInfo.title;
  },
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

.el-tag {
  margin-right: 5px;
  margin-bottom: 5px;
}
</style>