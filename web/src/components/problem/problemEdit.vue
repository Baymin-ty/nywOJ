<template>
  <el-row style="margin: auto;max-width: 1500px;min-width: 800px;">
    <el-col :span="18">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <p class="title">#{{ problemInfo.pid }}、<el-input size="large" v-model="problemInfo.title"
                style="width: 200px;" /></p>
          </div>
        </template>
        <v-md-editor height="600px" v-model="problemInfo.description"></v-md-editor>
      </el-card>
    </el-col>
    <el-col :span="6">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            题目信息 (提交: {{ problemInfo.submitCnt }} AC: {{ problemInfo.acCnt }})
          </div>
        </template>
        <el-descriptions direction="vertical" :column="1" border>
          <el-descriptions-item label="时间限制">
            <el-input v-model="problemInfo.timeLimit" style="width: 80px;" /> ms
          </el-descriptions-item>
          <el-descriptions-item label="空间限制">
            <el-input v-model="problemInfo.memoryLimit" style="width: 80px;" /> MB
          </el-descriptions-item>
          <el-descriptions-item label="题目类型">
            <el-select v-model="problemInfo.type" placeholder="评测结果" style="width: 150px;">
              <el-option v-for="item in ptype" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-descriptions-item>
          <el-descriptions-item label="题目标签">
            <el-tag v-for="tag in problemInfo.tags" :key="tag" closable class="mx-1" @close="removeTag(tag)">
              {{ tag }}
            </el-tag>
            <el-input v-if="inputVisible" v-model="newTag" class="ml-1 w-20" size="small" @keyup.enter="addTag"
              @blur="addTag" style="width: 80px;" />
            <el-button v-else class="button-new-tag ml-1" size="small" @click="inputVisible = true" style="width: 80px;">
              + New Tag
            </el-button>
          </el-descriptions-item>
          <el-descriptions-item label=" 出题人">
            <span class="rlink" @click="this.$router.push('/user/' + problemInfo.publisherUid)"> {{
              problemInfo.publisher
            }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="发布时间"> {{ problemInfo.time }} </el-descriptions-item>
          <el-descriptions-item label="是否公开">
            <el-switch v-model="problemInfo.isPublic" size="large" active-text="公开" inactive-text="隐藏" />
          </el-descriptions-item>
        </el-descriptions>
        <el-divider style="margin-top: 20px; margin-bottom: 20px;" />
        <div style="text-align: center;">
          <el-button type="primary" @click="this.$router.push('/problem/' + problemInfo.pid)">返回题目</el-button>
          <el-button type="danger" @click="updateProblem">更新题目</el-button>
          <el-button type="success" @click="this.$router.push('/problem/case/' + problemInfo.pid)">管理数据</el-button>
        </div>
      </el-card>
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios';
import { ElMessage } from 'element-plus'
import store from '@/sto/store';

export default {
  name: "problemEdit",
  data() {
    return {
      gid: 1,
      problemInfo: [],
      newTag: '',
      inputVisible: false,
      ptype: [
        { value: 0, label: '传统文本比较' },
        { value: 1, label: 'Special Judge' }
      ],
    }
  },
  methods: {
    updateProblem() {
      axios.post('/api/problem/updateProblem', {
        pid: this.problemInfo.pid,
        info: this.problemInfo
      }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '更新题目成功',
            type: 'success',
            duration: 1000,
          });
        }
        else {
          ElMessage({
            message: res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
      })
    },
    addTag() {
      if (this.newTag)
        this.problemInfo.tags.push(this.newTag);
      this.newTag = '';
      this.inputVisible = false;
    },
    removeTag(tag) {
      if (this.problemInfo.tags.includes(tag)) {
        this.problemInfo.tags.splice(this.problemInfo.tags.indexOf(tag), 1);
      }
    }
  },
  async mounted() {
    if (store.state.gid < 2) {
      this.$router.push('/');
      return;
    }
    this.pid = this.$route.params.pid;
    await axios.post('/api/problem/getProblemInfo', { pid: this.pid }).then(res => {
      this.problemInfo = res.data.data
      if (!this.problemInfo.description) this.problemInfo.description = "请输入题目描述";
      if (!this.problemInfo.title) this.problemInfo.title = "请输入题目标题";
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
  font-size: 25px;
}

.el-tag {
  margin-right: 5px;
  margin-bottom: 5px;
}
</style>