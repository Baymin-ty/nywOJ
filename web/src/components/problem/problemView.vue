<template>
  <el-row style="margin: auto;max-width: 1500px;min-width: 600px;">
    <el-col :xs="24" :sm="24" :md="18">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <p class="title">#{{ problemInfo.pid }}、{{ problemInfo.title }}</p>
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
            题目信息 (提交: {{ problemInfo.submitCnt }} AC: {{ problemInfo.acCnt }})
          </div>
        </template>
        <el-descriptions direction="vertical" :column="1" border>
          <el-descriptions-item label="时间限制"> {{ problemInfo.timeLimit }} ms</el-descriptions-item>
          <el-descriptions-item label="空间限制"> {{ problemInfo.memoryLimit }} MB</el-descriptions-item>
          <el-descriptions-item label="题目类型"> {{ problemInfo.type }} </el-descriptions-item>
          <el-descriptions-item label="题目标签">
            <el-tag v-for="tag in problemInfo.tags" :key="tag" class="mx-1">
              {{ tag }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label=" 出题人">
            <span class="rlink" @click="this.$router.push('/user/' + problemInfo.publisherUid)"> {{
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
          <el-button v-if="this.gid > 1" type="danger" @click="this.$router.push('/problem/edit/' + problemInfo.pid)">
            <el-icon class="el-icon--left">
              <Operation />
            </el-icon>
            题目管理
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
  name: "problemView",
  data() {
    return {
      pid: 0,
      gid: 1,
      problemInfo: {},
      code: '',
      isSubmit: false
    }
  },
  components: {
    monacoEditor
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
    },
  },
  async mounted() {
    this.pid = this.$route.params.pid;
    this.gid = this.$store.state.gid;
    await axios.post('/api/problem/getProblemInfo', { pid: this.pid }).then(res => {
      if (res.status === 200) {
        this.problemInfo = res.data.data
        this.problemInfo.isPublic = res.data.data.isPublic ? true : false;
      }
      else {
        this.$router.push({ path: '/' });
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

.el-tag {
  margin-right: 5px;
  margin-bottom: 5px;
}
</style>