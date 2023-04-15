<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1200px">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          测试点管理
          <el-button-group>
            <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认清空数据?" @confirm="delAllCase">
              <template #reference>
                <el-button type="danger">
                  <el-icon class="el-icon--left">
                    <Delete />
                  </el-icon>
                  清空数据
                </el-button>
              </template>
            </el-popconfirm>
            <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="重测所有代码?" @confirm="reJudgeProblem">
              <template #reference>
                <el-button color="#626aef" plain>
                  <el-icon class="el-icon--left">
                    <Refresh />
                  </el-icon>
                  重测整题
                </el-button>
              </template>
            </el-popconfirm>
            <el-button type="primary" @click="this.$router.push('/problem/edit/' + pid)">编辑题面</el-button>
          </el-button-group>
        </div>
      </template>
      <el-upload v-show="!casePreview" drag action="/api/problem/uploadData" :data="{ pid: pid }" accept=".zip"
        :on-success="reflushData">
        <el-icon class=" el-icon--upload">
          <UploadFilled />
        </el-icon>
        <div class="el-upload__text">
          Drop file here or <em>click to upload</em>
        </div>
        <template #tip>
          <div class="el-upload__tip">
            ZIP file with a size less than 100 MB
          </div>
        </template>
      </el-upload>
      <v-md-preview v-show="casePreview" :text="casePreview"> </v-md-preview>
    </el-card>
  </div>
</template>

<script>
import axios from 'axios';
import { ElMessage } from 'element-plus'


export default {
  name: "problemEdit",
  data() {
    return {
      pid: 0,
      casePreview: "",
    };
  },
  methods: {
    async delAllCase() {
      await axios.post('/api/problem/clearCase', {
        pid: this.pid,
      }).then(res => {
        if (res.status !== 200) {
          ElMessage({
            message: res.data.message,
            type: 'error',
            duration: 2000,
          });
        } else {
          ElMessage({
            message: '数据已清空',
            type: 'success',
            duration: 1000,
          });
          this.casePreview = "";
          this.all();
        }
      });
    },
    async all(op) {
      await axios.post('/api/problem/getProblemCasePreview', {
        pid: this.pid,
      }).then(res => {
        let cases = res.data.data;
        if (!cases.length && op) {
          ElMessage({
            message: (op === 1 ? '数据还未上传' : '数据未处理完成或数据格式错误，请手动刷新或重新上传数据'),
            type: 'error',
            duration: 2000,
          });
        }
        this.casePreview = "";
        if (res.data.spj.length) {
          this.casePreview = "# checker.cpp\n";

          this.casePreview += "```c++\n";
          this.casePreview += res.data.spj;

          if (res.data.spj && res.data.spj[res.data.spj.length - 1] !== '\n')
            this.casePreview += '\n';
          this.casePreview += "```\n";
        }
        for (let i = 0; i < cases.length; i++) {
          this.casePreview += '# Case ' + cases[i].index + '\n';
          this.casePreview += '### Input\n';
          this.casePreview += '```\n';
          this.casePreview += cases[i].input;

          if (cases[i].input && cases[i].input[cases[i].input.length - 1] !== '\n')
            this.casePreview += '\n';

          this.casePreview += '```\n';

          this.casePreview += '### Output\n';
          this.casePreview += '```\n';
          this.casePreview += cases[i].output;

          if (cases[i].output && cases[i].output[cases[i].output.length - 1] !== '\n')
            this.casePreview += '\n';

          this.casePreview += '```\n';
        }
      });
    },
    async reflushData() {
      await (this.casePreview = "> 正在处理测试点中...");
      setTimeout(() => {
        this.all(2);
      }, 1000);
    },
    reJudgeProblem() {
      axios.post('/api/judge/reJudgeProblem', {
        pid: this.pid,
      }).then(res => {
        if (res.data.total > 0) {
          this.$router.push({
            path: '/submission',
            query: {
              pid: this.pid
            }
          })
        } else {
          ElMessage({
            message: '暂时无人提交',
            type: 'error',
            duration: 2000,
          });
        }
      });
    }
  },
  async mounted() {
    if (this.$store.state.gid < 2) {
      this.$router.push('/');
      return;
    }
    this.pid = this.$route.params.pid;
    this.all(1);
  }
}
</script>

<style scoped>
.box-card {
  margin: 10px;
  text-align: left;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
}
</style>