<template>
  <el-row class="problem-edit-page">
    <el-col :xs="24" :sm="24" :md="17">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header" style="height: 35px;">
            <p class="title">
              <span style="vertical-align: -3px;">#{{ problemInfo.pid }}、</span>
              <el-input size="large" v-model="problemInfo.title" style="width: 200px;" />
              <el-switch v-model="problemInfo.isPublic" style="margin-left: 10px;" size="large" active-text="公开"
                inactive-text="隐藏" :disabled="!auth.manage" @change="setProblemPublic" />
            </p>
          </div>
        </template>
        <v-md-editor height="600px"
          left-toolbar="undo redo clear | h bold italic strikethrough quote | ul ol table hr | link image code"
          v-model="problemInfo.description"></v-md-editor>
      </el-card>
    </el-col>
    <el-col :xs="24" :sm="24" :md="7">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <div class="stat-item clickable"
              @click="this.$router.push({ path: '/submission', query: { pid: pid, res: 4, queryAll: true } })">
              <div class="stat-number">{{ problemInfo.acCnt }}</div>
              <div class="stat-label">通过</div>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item clickable"
              @click="this.$router.push({ path: '/submission', query: { pid: pid, queryAll: true } })">
              <div class="stat-number">{{ problemInfo.submitCnt }}</div>
              <div class="stat-label">提交</div>
            </div>
          </div>
        </template>
        <el-descriptions direction="vertical" :column="1" border>
          <el-descriptions-item label="时间限制">
            <el-input v-model="problemInfo.timeLimit" style="width: 80px;" /> ms
          </el-descriptions-item>
          <el-descriptions-item label="空间限制">
            <el-input v-model="problemInfo.memoryLimit" style="width: 80px;" /> MB
          </el-descriptions-item>
          <el-descriptions-item label="评测方式">
            <div class="judge-method">{{ problemInfo.judgeSummary?.label || '—' }}<span
                v-if="problemInfo.judgeSummary?.compare" class="judge-compare"> · {{ problemInfo.judgeSummary.compare
                }}</span></div>
            <el-button type="primary" link size="small" @click="this.$router.push('/problem/case/' + problemInfo.pid)">
              <el-icon class="el-icon--left">
                <SetUp />
              </el-icon>
              在「管理数据 → 评测流程」中配置
            </el-button>
          </el-descriptions-item>
          <el-descriptions-item label="题目标签">
            <el-tag type="info" v-for="tag in problemInfo.tags" :key="tag" closable @close="removeTag(tag)"
              :color="getTagColor(tag)"
              @click="this.$router.push({ path: '/problem', query: { tags: JSON.stringify([tag]) } })">
              <span class="tag-text">{{ tag }} </span>
            </el-tag>
            <el-input v-if="inputVisible" v-model="newTag" size="small" ref="inputRef" @keyup.enter="addTag"
              @blur="addTag" style="width: 80px;" />
            <el-button v-else class="button-new-tag ml-1" size="small" @click="showInput" style="width: 80px;">
              + New Tag
            </el-button>
          </el-descriptions-item>
          <el-descriptions-item label="难度评级">
            <el-select v-model="problemInfo.level" placeholder="难度评级" style="width: 150px;">
              <el-option v-for="item in levels" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-descriptions-item>
          <el-descriptions-item v-if="!isAnswerProblem" label="支持语言">
            <el-select v-model="avalangList" multiple collapse-tags :max-collapse-tags="3" placeholder="支持语言">
              <el-option v-for="l in this.$store.state.langList" :key="l.id" :label="l.des" :value="l.id" />
            </el-select>
          </el-descriptions-item>
        </el-descriptions>
        <el-divider style="margin-top: 20px; margin-bottom: 20px;" />
        <div class="edit-actions">
          <el-button type="primary" @click="this.$router.push(problemPath)">
            <el-icon class="el-icon--left">
              <Back />
            </el-icon>
            返回题目
          </el-button>
          <el-button type="danger" @click="updateProblem" :disabled="!auth.manage">
            <el-icon class="el-icon--left">
              <CircleCheck />
            </el-icon>
            更新题目
          </el-button>
          <el-button type="success" @click="this.$router.push('/problem/case/' + problemInfo.pid)">
            <el-icon class="el-icon--left">
              <SetUp />
            </el-icon>
            管理数据
          </el-button>
          <el-button type="warning" plain @click="this.$router.push('/problem/ai/' + problemInfo.pid)" :disabled="!auth.manage">
            <el-icon class="el-icon--left">
              <DataAnalysis />
            </el-icon>
            LLM 助手
          </el-button>
          <el-button type="danger" plain @click="deleteProblem" :disabled="!auth.manage">
            <el-icon class="el-icon--left">
              <Delete />
            </el-icon>
            删除题目
          </el-button>
        </div>
      </el-card>
    </el-col>
    <el-col :span="24" v-if="auth.manage && problemInfo.pid">
      <CollaboratorPanel
        resource-type="problem"
        :resource-id="problemInfo.pid"
        :visible="auth.manage"
        :can-edit="isOwner"
      />
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios';
import { ElMessageBox } from 'element-plus';
import CollaboratorPanel from '@/components/permission/CollaboratorPanel.vue';

export default {
  name: "problemEdit",
  components: { CollaboratorPanel },
  computed: {
    // Owners (and global grantors) can manage the collaborator list.
    // Collaborators with manage.any scoped to this problem can only view it.
    isOwner() {
      return this.problemInfo
        && this.problemInfo.publisherUid === this.$store.state.uid
        || this.$can('user.role.admin');
    },
    // problemInfo.type can be either the integer (after user picks in select)
    // or the localized label (on initial load from getProblemInfo). Match both.
    isAnswerProblem() {
      const t = this.problemInfo.type;
      return t === 2 || t === 3 || t === '提交答案' || t === '提交答案 (SPJ)';
    },
    problemPath() {
      return `/problem/${this.problemInfo.pid}`;
    },
  },
  data() {
    return {
      problemInfo: [],
      newTag: '',
      avalangList: [],
      inputVisible: false,
      auth: {},
      levels: [
        {
          value: 0,
          label: '暂未评级',
        },
        {
          value: 1,
          label: '入门',
        },
        {
          value: 2,
          label: '普及',
        },
        {
          value: 3,
          label: '提高',
        },
        {
          value: 4,
          label: '省选',
        },
        {
          value: 5,
          label: 'NOI / NOI+',
        },
      ],
      tagColorList: [
        '#2d8cf0',
        '#3f51b5',
        '#9c27b0',
        '#009688',
        '#19be6b',
        '#689f38',
        '#ff9900',
        '#E91E63',
        '#ed4014'
      ],
    }
  },
  methods: {
    apiOk(res) {
      return res.status === 200 && !(res.data && res.data.error);
    },
    apiMessage(res, fallback) {
      return (res.data && (res.data.message || res.data.error)) || fallback;
    },
    updateProblem() {
      if (!this.isAnswerProblem && !this.avalangList.length) {
        this.$message.error('请选择至少一个支持语言');
        return;
      }
      this.problemInfo.lang = 0;
      for (let i of this.avalangList)
        this.problemInfo.lang |= (1 << i);
      axios.post('/api/problem/updateProblem', {
        pid: this.problemInfo.pid,
        info: this.problemInfo
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('更新题目成功');
        }
        else {
          this.$message.error(res.data.message);
        }
        this.all();
      })
    },
    setProblemPublic(value) {
      axios.post('/api/problem/setProblemPublic', {
        pid: this.problemInfo.pid,
        isPublic: value,
      }).then(res => {
        if (this.apiOk(res)) {
          this.problemInfo.isPublic = !!res.data.isPublic;
          this.$message.success(this.problemInfo.isPublic ? '题目已公开' : '题目已隐藏');
        } else {
          this.problemInfo.isPublic = !value;
          this.$message.error(this.apiMessage(res, '更新公开状态失败'));
        }
      }).catch(err => {
        this.problemInfo.isPublic = !value;
        this.$message.error(err.message || '更新公开状态失败');
      });
    },
    async deleteProblem() {
      try {
        await ElMessageBox.confirm(
          `确认删除题目 #${this.problemInfo.pid || this.pid}？题面、测试数据、提交记录和题解绑定都会被删除。`,
          '删除题目',
          { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
        );
        const res = await axios.post('/api/problem/deleteProblem', { pid: this.problemInfo.pid });
        if (this.apiOk(res)) {
          this.$message.success('题目已删除');
          this.$router.push('/problem');
        } else {
          this.$message.error(this.apiMessage(res, '删除题目失败'));
        }
      } catch (err) {
        if (err !== 'cancel' && err !== 'close') this.$message.error(err.message || '删除题目失败');
      }
    },
    showInput() {
      this.inputVisible = true;
      this.$nextTick(() =>
        this.$refs.inputRef.focus()
      )
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
    },
    all() {
      axios.post('/api/problem/getProblemInfo', { pid: this.pid }).then(res => {
        this.problemInfo = res.data.data
        this.avalangList = [];
        for (let l in this.$store.state.langList) {
          let lid = this.$store.state.langList[l].id;
          if ((1 << lid) & this.problemInfo.lang)
            this.avalangList.push(lid);
        }
        if (!this.problemInfo.description) this.problemInfo.description = "请输入题目描述";
        if (!this.problemInfo.title) this.problemInfo.title = "请输入题目标题";
        this.problemInfo.isPublic = res.data.data.isPublic ? true : false;
      });
    },
    hash(str) {
      let t = 0;
      for (let i = 0; i < str.length; i++)
        t = 31 * t + str.charCodeAt(i);
      return t;
    },
    getTagColor(tag) {
      return this.tagColorList[this.hash(tag) % this.tagColorList.length];
    },
  },
  mounted() {
    // Authorization: manage permission is required to be on this page at all.
    // The server-side problemAuth.manage is the final word; redirect away
    // immediately if the user can only view.
    this.pid = this.$route.params.pid;
    axios.post('/api/problem/getProblemAuth', {
      pid: this.pid,
    }).then(res => {
      this.auth = res.data.data;
      if (!this.auth.manage) {
        this.$message.warning('你没有该题目的管理权限');
        this.$router.push(`/problem/${this.pid}`);
      }
    });
    this.all();
  }
}
</script>

<style scoped>
.box-card {
  margin: 10px;
  text-align: left;
}

.problem-edit-page {
  margin: auto;
  max-width: 1500px;
  min-width: 0;
}


.card-header {
  display: flex;
  align-items: center;
  justify-content: space-around;
}

.stat-item {
  text-align: center;
  flex: 1;
}

.clickable {
  cursor: pointer;
  transition: background-color 0.3s;
  border-radius: 5px;
}

.clickable:hover {
  background-color: #f5f7fa;
}

.stat-number {
  font-size: 28px;
  font-weight: bold;
  color: #303133;
}

.stat-label {
  font-size: 14px;
  color: #909399;
  margin-top: 3px;
}

.stat-divider {
  width: 1px;
  height: 60px;
  background-color: #e0e0e0;
  margin: 0 20px;
}

.title {
  margin: 0;
  font-size: 25px;
}

.el-tag {
  cursor: pointer;
  margin-right: 5px;
}

.tag-text {
  color: white;
  font-weight: 600;
  font-size: 14px;
}

.judge-method {
  font-weight: 600;
  color: #303133;
  margin-bottom: 2px;
}

.judge-compare {
  font-weight: 400;
  color: #909399;
}

.edit-actions {
  text-align: center;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.edit-actions .el-button {
  margin-left: 0;
}

@media (max-width: 768px) {
  .box-card {
    margin: 0 0 10px;
  }

  .title {
    font-size: 20px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .title .el-input {
    width: min(100%, 220px) !important;
  }

  .stat-number {
    font-size: 22px;
  }
}
</style>
