<template>
  <el-row style="margin: auto;max-width: 1500px;min-width: 600px;">
    <el-col :xs="24" :sm="24" :md="18">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <p class="title">T{{ problemInfo.idx }}、{{ problemInfo.title }}</p>
          </div>
        </template>
        <div v-if="isSubmit">
          <monacoEditor :value="code" @update:value="code = $event" />
          <el-divider />
          <div style="text-align: center;">
            <el-button type="primary" @click="submit">
              <el-icon class="el-icon--left">
                <Upload />
              </el-icon>
              确认提交
            </el-button>
          </div>
        </div>
        <v-md-preview v-show="!isSubmit" :text="problemInfo.description"> </v-md-preview>
      </el-card>
    </el-col>
    <el-col :xs="24" :sm="24" :md="6">
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
            <span class="rlink" @click="this.$router.push('/user/' + problemInfo.publisherUid)">
              {{ problemInfo.publisher }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="发布时间"> {{ problemInfo.time }} </el-descriptions-item>
        </el-descriptions>
        <el-divider style="margin-top: 20px; margin-bottom: 20px;" />
        <div style="text-align: center;">
          <el-button v-if="!this.isSubmit" type="primary" @click="this.isSubmit = true">
            <el-icon class="el-icon--left">
              <Upload />
            </el-icon>
            提交代码
          </el-button>
          <el-button v-if="this.isSubmit" type="success" @click="this.isSubmit = false">
            <el-icon class="el-icon--left">
              <RefreshLeft />
            </el-icon>
            返回题目
          </el-button>
          <el-button type="success" @click="this.$router.push({
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
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios';
import { ElMessage } from 'element-plus'
import monacoEditor from '@/components/monacoEditor.vue'

export default {
  name: "contestProblemView",
  data() {
    return {
      cid: 0,
      pid: 0,
      gid: 1,
      problemInfo: {},
      code: "",
      isSubmit: false
    };
  },
  components: {
    monacoEditor
  },
  methods: {
    submit() {
      axios.post("/api/contest/submit", {
        cid: this.cid,
        idx: this.idx,
        id: this.problemInfo.id,
        code: this.code
      }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: "提交成功",
            type: "success",
            duration: 1000,
          });
          this.isSubmit = false;
          this.code = '';
        }
        else {
          ElMessage({
            message: "提交失败" + res.data.message,
            type: "error",
            duration: 3000,
          });
          if (res.data.refresh) {
            this.$router.push({
              path: '/contest/' + this.cid,
              query: { tab: 'problem' }
            });
          }
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
        this.$router.push({ path: '/' });
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