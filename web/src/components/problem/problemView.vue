<template>
  <div class="page-wrap page-wrap--sub">
    <el-row :gutter="12">
      <!-- Main: problem content -->
      <el-col :xs="24" :md="17" class="col-main">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header prob-title-header">
              <h1 class="prob-title">
                #{{ problemInfo.pid }}、{{ problemInfo.title }}
                <el-icon id="hidden" v-if="!problemInfo.isPublic"><Hide /></el-icon>
              </h1>
            </div>
          </template>

          <!-- Problem description -->
          <v-md-preview v-show="!isSubmit" :text="problemInfo.description" />

          <!-- Submit panel -->
          <div v-if="isSubmit" class="submit-panel">
            <div class="submit-lang">
              <span>选择语言：</span>
              <el-select v-model="submitLang" placeholder="选择语言" style="width:180px">
                <el-option v-for="l in langList" :key="l.id" :label="l.des" :value="l.id" />
              </el-select>
            </div>
            <el-divider />
            <monacoEditor
              :value="code"
              :language="$store.state.langList[submitLang]?.lang ?? 'cpp'"
              @update:value="code = $event"
            />
            <el-divider />
            <div class="submit-actions">
              <el-button type="primary" @click="submit">
                <el-icon class="el-icon--left"><Upload /></el-icon>确认提交
              </el-button>
              <el-button @click="isSubmit = false">
                <el-icon class="el-icon--left"><RefreshLeft /></el-icon>查看题目
              </el-button>
            </div>
          </div>
        </el-card>
      </el-col>

      <!-- Sidebar -->
      <el-col :xs="24" :md="7" class="col-sidebar">
        <el-card shadow="hover">
          <!-- AC / Submit stats -->
          <template #header>
            <div class="stat-header">
              <div class="stat-item clickable"
                @click="$router.push({ path:'/submission', query:{ pid, res:4, queryAll:true } })">
                <div class="stat-num">{{ problemInfo.acCnt }}</div>
                <div class="stat-lbl">通过</div>
              </div>
              <div class="stat-divider"></div>
              <div class="stat-item clickable"
                @click="$router.push({ path:'/submission', query:{ pid, queryAll:true } })">
                <div class="stat-num">{{ problemInfo.submitCnt }}</div>
                <div class="stat-lbl">提交</div>
              </div>
            </div>
          </template>

          <el-descriptions direction="vertical" :column="1" border size="small">
            <el-descriptions-item label="时间限制">{{ problemInfo.timeLimit }} ms</el-descriptions-item>
            <el-descriptions-item label="空间限制">{{ problemInfo.memoryLimit }} MB</el-descriptions-item>
            <el-descriptions-item label="比对方式">{{ problemInfo.type }}</el-descriptions-item>
            <el-descriptions-item label="难度评级">
              <el-button size="small" :color="levels[problemInfo.level]?.color ?? '#BFBFBF'" :dark="true"
                @click="$router.push({ path:'/problem', query:{ level: problemInfo.level } })">
                <span class="tag-text">{{ levels[problemInfo.level]?.label ?? '未知' }}</span>
              </el-button>
            </el-descriptions-item>
            <el-descriptions-item label="题目标签">
              <el-tag
                type="info" v-for="tag in problemInfo.tags" :key="tag"
                :color="getTagColor(tag)" size="small" style="margin:2px; cursor:pointer"
                @click="$router.push({ path:'/problem', query:{ tags: JSON.stringify([tag]) } })">
                <span class="tag-text">{{ tag }}</span>
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="出题人">
              <router-link class="rlink" :to="'/user/'+problemInfo.publisherUid">{{ problemInfo.publisher }}</router-link>
            </el-descriptions-item>
            <el-descriptions-item label="发布时间">{{ problemInfo.time }}</el-descriptions-item>
          </el-descriptions>

          <el-divider />

          <div class="sidebar-actions">
            <el-button v-if="!isSubmit" type="primary" @click="isSubmit = true">
              <el-icon class="el-icon--left"><Upload /></el-icon>提交代码
            </el-button>
            <el-button v-if="isSubmit" type="success" @click="isSubmit = false">
              <el-icon class="el-icon--left"><RefreshLeft /></el-icon>查看题目
            </el-button>
            <el-button color="#626aef"
              @click="$router.push('/problem/stat/'+problemInfo.pid)">
              <el-icon class="el-icon--left"><Histogram /></el-icon>统计
            </el-button>
            <el-button v-if="gid > 1" type="danger"
              @click="$router.push('/problem/edit/'+problemInfo.pid)">
              <el-icon class="el-icon--left"><Operation /></el-icon>管理
            </el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script>
import axios from 'axios';
import monacoEditor from '@/components/monacoEditor.vue';

export default {
  name: "problemView",
  components: { monacoEditor },
  data() {
    return {
      pid: 0, gid: 1, submitLang: null, langList: [],
      problemInfo: {}, code: '', isSubmit: false,
      levels: [
        { label: '暂未评级', color: '#BFBFBF' }, { label: '入门',     color: '#FE4C61' },
        { label: '普及',     color: '#FFC116' }, { label: '提高',     color: '#52C41A' },
        { label: '省选',     color: '#3498DB' }, { label: 'NOI/NOI+', color: '#0E1D69' },
      ],
      tagColorList: ['#2d8cf0','#3f51b5','#9c27b0','#009688','#19be6b','#689f38','#ff9900','#E91E63','#ed4014'],
    };
  },
  methods: {
    submit() {
      axios.post('/api/judge/submit', { pid: this.pid, code: this.code, lang: this.submitLang })
        .then(res => {
          if (res.status === 200) this.$router.push('/submission/' + res.data.sid);
          else this.$message.error('提交失败 ' + res.data.message);
        });
    },
    hash(str) { let t=0; for(let i=0;i<str.length;i++) t=31*t+str.charCodeAt(i); return t; },
    getTagColor(tag) { return this.tagColorList[Math.abs(this.hash(tag)) % this.tagColorList.length]; },
  },
  async mounted() {
    this.pid = this.$route.params.pid;
    this.gid = this.$store.state.gid;
    await axios.post('/api/problem/getProblemInfo', { pid: this.pid }).then(res => {
      if (res.status === 200) {
        this.problemInfo = res.data.data;
        this.problemInfo.isPublic = !!res.data.data.isPublic;
        for (let l in this.$store.state.langList) {
          const lid = this.$store.state.langList[l].id;
          if ((1 << lid) & this.problemInfo.lang) {
            this.langList.push(this.$store.state.langList[l]);
            if (!this.submitLang) this.submitLang = lid;
            if (lid === this.$store.state.preferenceLang) this.submitLang = lid;
          }
        }
        document.title = '题目 — ' + this.problemInfo.title;
      } else {
        this.$router.push('/problem');
        this.$message.error(res.data.message);
      }
    });
  },
};
</script>

<style scoped>
.col-main, .col-sidebar { margin-bottom: 12px; }

.prob-title-header { padding: 4px 0; }
.prob-title { margin: 0; font-size: 22px; font-weight: 800; color: #2c3e50; }

.stat-header {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 4px 0;
}
.stat-item { text-align: center; flex: 1; }
.stat-num  { font-size: 26px; font-weight: 700; color: #303133; }
.stat-lbl  { font-size: 13px; color: #909399; margin-top: 2px; }
.stat-divider { width: 1px; height: 50px; background: #e0e0e0; margin: 0 12px; }
.clickable { cursor: pointer; border-radius: 6px; transition: background 0.2s; }
.clickable:hover { background: #f5f7fa; }

.submit-panel { padding-top: 4px; }
.submit-lang  { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; font-size: 14px; }
.submit-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }

.sidebar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
</style>
