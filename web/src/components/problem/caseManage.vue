<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1200px">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <div>
            测试点管理
            <el-button style="vertical-align: middle; margin-left: 8px;" plain size="small" v-text="'下载'"
              @click="downloadCase(0)" :disabled="!auth.manage" />
          </div>
          <el-button-group>
            <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认清空数据?" @confirm="delAllCase">
              <template #reference>
                <el-button type="danger" :disabled="!auth.manage">
                  <el-icon class="el-icon--left">
                    <Delete />
                  </el-icon>
                  清空数据
                </el-button>
              </template>
            </el-popconfirm>
            <el-button type="success" plain @click="updateSubtaskId" :disabled="!auth.manage">
              <el-icon class="el-icon--left">
                <CircleCheck />
              </el-icon>
              保存子任务
            </el-button>
            <el-button type="warning" @click="addSubtask" :disabled="!auth.manage">
              <el-icon class="el-icon--left">
                <CirclePlus />
              </el-icon>
              新增子任务
            </el-button>
            <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="重测所有代码?" @confirm="reJudgeProblem">
              <template #reference>
                <el-button color="#626aef" plain :disabled="!auth.manage">
                  <el-icon class="el-icon--left">
                    <Refresh />
                  </el-icon>
                  重测整题
                </el-button>
              </template>
            </el-popconfirm>
            <el-button type="primary" @click="this.$router.push('/problem/edit/' + pid)">
              <el-icon class="el-icon--left">
                <Edit />
              </el-icon>
              编辑题面
            </el-button>
          </el-button-group>
        </div>
      </template>
      <el-upload v-if="!cases.length" drag action="/api/problem/uploadData" :data="{ pid: pid }" accept=".zip"
        :on-error="handleUploadError" :on-success="reflushData" v-loading="!finished" :disabled="!auth.manage">
        <el-icon class="el-icon--upload">
          <UploadFilled />
        </el-icon>
        <div class="el-upload__text">
          Drop file here or <em>click to upload</em>
        </div>
        <template #tip>
          <div class="el-upload__tip">
            ZIP file with a size less than 200 MB
          </div>
        </template>
      </el-upload>
      <div class="cases" v-if="cases.length">
        <el-table :data="this.subtask" style="padding-bottom: 5px;" :header-cell-style="{ textAlign: 'center' }"
          :cell-style="{ textAlign: 'center' }">
          <el-table-column fixed="left" label="删除" min-width="10%">
            <template #default="scope">
              <el-button link type="primary" size="small" @click.prevent="this.subtask.splice(scope.$index, 1)">
                <el-icon>
                  <CloseBold />
                </el-icon>
              </el-button>
            </template>
          </el-table-column>
          <el-table-column label="编号" min-width="10%">
            <template #default="scope">
              <span> {{ scope.row.index }} </span>
            </template>
          </el-table-column>
          <el-table-column label="分数" min-width="25%">
            <template #default="scope">
              <el-input style="max-width: 120px;" v-model="scope.row.score">
                <template #append>分</template>
              </el-input>
            </template>
          </el-table-column>
          <el-table-column label="记分方式" min-width="25%">
            <template #default="scope">
              <div>
                <el-radio-group v-model="scope.row.option">
                  <el-radio-button :value="0"
                    @click="scope.row.dependencies = [], scope.row.skip = 0">等分</el-radio-button>
                  <el-radio-button :value="1">全过得分</el-radio-button>
                </el-radio-group>
                <br>
                <el-switch style="margin-top: 5px;" v-if="scope.row.option" v-model="scope.row.skip"
                  active-text="遇TLE止测" inactive-text="全测" />
              </div>
            </template>
          </el-table-column>
          <el-table-column label="依赖子任务" min-width="30%">
            <template #default="scope">
              <el-select :disabled="!scope.row.option" v-model="scope.row.dependencies" multiple filterable clearable
                placeholder="依赖子任务" style="width: 200px;">
                <el-option v-for="i in scope.row.index - 1" :key="i" :label="i" :value="i" />
              </el-select>
            </template>
          </el-table-column>
        </el-table>
        <div v-for="i in cases" :key="i.index">
          <div class="header">
            <span>
              Case #{{ i.index }}
            </span>
            <el-button :type="(i.edit > 1 ? 'danger' : 'primary')" style="vertical-align: middle; margin-left: 10px;"
              plain size="small" @click="edit(i)" v-text="i.edit ? (i.edit === 1 ? '取消' : '保存') : '编辑'"
              :disabled="!auth.manage" />
            <el-button style="vertical-align: middle; margin-left: 8px;" plain size="small" v-text="'下载'"
              @click="downloadCase(i.index)" :disabled="!auth.manage" />
            <div class="subtask">
              <el-input v-model="i.subtaskId">
                <template #prepend>
                  <el-popover placement="left" :width="320" trigger="hover">
                    <template #reference>
                      <span>子任务编号</span>
                    </template>
                    <span>将 </span>
                    <el-input v-model="tool.left" style="width: 50px" placeholder="[" />
                    <span> 到 </span>
                    <el-input v-model="tool.right" style="width: 50px" placeholder="]" />
                    <span> 设为 </span>
                    <el-input v-model="tool.id" style="width: 50px" placeholder="id" />
                    <el-button @click="setIds" style="margin-left: 5px;">确定</el-button>
                  </el-popover>
                </template>
              </el-input>
            </div>
          </div>
          <el-divider />
          <span class="attach">
            {{ i.inName }} | {{ i.input.size }} | create: {{ i.input.create }} | modified: {{ i.input.modified }}
          </span>
          <el-input type="textarea" @input="i.edit = 2" v-if="i.edit" :autosize="{ minRows: 2, maxRows: 12 }"
            v-model="i.input.content" />
          <pre v-else v-text="i.input.content" />
          <span class="attach">
            {{ i.outName }} | {{ i.output.size }} | create: {{ i.output.create }} | modified: {{ i.output.modified }}
          </span>
          <el-input type="textarea" @input="i.edit = 2" v-if="i.edit" :autosize="{ minRows: 2, maxRows: 12 }"
            v-model="i.output.content" />
          <pre v-else v-text="i.output.content" />
        </div>
        <div v-if="this.spj.length">
          <div class="header">
            Checker.cpp
          </div>
          <v-md-preview :text="this.spj" />
        </div>
      </div>
    </el-card>
  </div>
</template>

<script>
import axios from 'axios';

export default {
  name: "problemEdit",
  data() {
    return {
      pid: 0,
      cases: [],
      finished: false,
      spj: '',
      subtask: [],
      auth: {},
      tool: {
        left: null,
        right: null,
        id: null
      }
    };
  },
  methods: {
    delAllCase() {
      axios.post('/api/problem/clearCase', {
        pid: this.pid,
      }).then(res => {
        if (res.status !== 200) {
          this.$message.error(res.data.message);
        } else {
          this.$message.success('数据已清空');
          this.spj = "";
          this.all();
        }
      });
    },
    all(op) {
      this.finished = false;
      axios.post('/api/problem/getProblemCasePreview', {
        pid: this.pid,
      }).then(res => {
        for (let i of res.data.subtask)
          if (!i.dependencies) i.dependencies = [];
        this.cases = res.data.data;
        this.subtask = res.data.subtask;
        if (res.data.spj) {
          this.spj += "```c++\n";
          this.spj += res.data.spj;

          if (res.data.spj && res.data.spj[res.data.spj.length - 1] !== '\n')
            this.spj += '\n';
          this.spj += "```\n";
        }
        if (!this.cases.length && op) {
          this.$message.error((op === 1 ? '数据还未上传' : '数据未处理完成或数据格式错误，请手动刷新或重新上传数据'));
        }
        this.finished = true;
      });
    },
    async reflushData(res) {
      if (res.err) {
        this.$message.error('上传错误' + res.err);
      }
      else {
        this.all(2);
      }
    },
    reJudgeProblem() {
      axios.post('/api/judge/reJudgeProblem', {
        pid: this.pid,
      }).then(res => {
        if (res.data.total > 0) {
          this.$router.push({ path: '/problem/stat/' + this.pid });
        } else {
          this.$message.error('暂时无人提交');
        }
      });
    },
    updateSubtaskId() {
      for (let i in this.cases)
        if (!this.cases[i].subtaskId)
          this.cases[i].subtaskId = 0;
      for (let i in this.subtask)
        this.subtask[i].score = Number(this.subtask[i].score);
      axios.post('/api/problem/updateSubtaskId', {
        subtask: this.subtask,
        pid: this.pid,
        cases: this.cases
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('更新成功');
          this.all();
        } else {
          this.$message.error('更新失败' + res.data.message);
        }
      })
    },
    addSubtask() {
      if (!this.subtask.length) {
        this.subtask.push({
          index: 1,
          score: 0,
          option: 1
        });
      } else {
        this.subtask.push({
          index: this.subtask[this.subtask.length - 1].index + 1,
          score: 0,
          option: 1
        });
      }
    },
    edit(i) {
      if (!i.edit) {
        axios.post('/api/problem/getCase', {
          pid: this.pid,
          caseInfo: {
            inName: i.inName,
            outName: i.outName
          }
        }).then(res => {
          if (res.status === 200) {
            i.edit = 1;
            i.input.content = res.data.input;
            i.output.content = res.data.output;
          } else {
            this.$message.error(res.data.message);
          }
        });
      } else {
        if (i.edit === 1) {
          i.edit = 0;
          return;
        }
        axios.post('/api/problem/updateCase', {
          pid: this.pid,
          caseInfo: i
        }).then(res => {
          if (res.status === 200) {
            i.edit = 0;
            i.input.modified = res.data.inputM;
            i.output.modified = res.data.outputM;
            this.$message.success('保存成功');
          } else {
            this.$message.error('保存失败' + res.data.message);
          }
        });
      }
    },
    downloadCase(index) {
      let url = '/api/problem/downloadCase?pid=' + this.pid;
      if (index) url += ('&index=' + index);
      window.location.href = url;
    },
    handleUploadError(err) {
      this.$message.error('上传失败' + err);
    },
    setIds() {
      this.tool.left = Number(this.tool.left);
      this.tool.right = Number(this.tool.right);
      this.tool.id = Number(this.tool.id)
      if (this.tool.left > this.tool.right ||
        this.tool.left < 1 || this.tool.right > this.cases.length ||
        this.tool.id < 1 || this.tool.id > this.subtask.length) {
        this.$message.error('out of range');
        return;
      }
      for (let i = this.tool.left - 1; i < this.tool.right; i++)
        this.cases[i].subtaskId = this.tool.id;
      this.$message.success('设置成功');
    }
  },
  mounted() {
    if (this.$store.state.gid < 2) {
      this.$router.push(`/problem/${this.$route.params.pid}`);
      return;
    }
    this.pid = this.$route.params.pid;
    axios.post('/api/problem/getProblemAuth', {
      pid: this.pid,
    }).then(res => {
      this.auth = res.data.data;
    });
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

.header {
  padding-top: 5px;
  font-size: 24px;
  font-weight: 800;
}

.attach {
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 14px;
  font-weight: 500;
  color: #585858;
}

pre {
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  display: block;
  max-height: 160px;
  overflow: auto;
  padding: 10px;
  margin: 10px 0;
  font-size: 14px;
  font-weight: 400;
  line-height: 1;
  word-break: break-all;
  word-wrap: break-word;
  color: #333;
  background-color: #f5f5f5;
  border: 1px solid #ccc;
  border-radius: 4px;
}

:deep(textarea) {
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  display: block;
  overflow: auto;
  padding: 10px;
  margin: 10px 0;
  font-size: 14px;
  font-weight: 400;
  line-height: 1;
  word-break: break-all;
  word-wrap: break-word;
  color: #333;
}

:deep(.github-markdown-body) {
  padding: 10px 0;
}

.cases {
  padding: 0 10px 20px 10px;
}

.subtask {
  float: right;
  width: 180px;
}
</style>