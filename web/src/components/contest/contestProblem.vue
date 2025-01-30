<template>
  <el-row style="margin: auto;max-width: 1500px;min-width: 600px;">
    <el-col :xs="24" :sm="24" :md="17">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <p class="title">T{{ problemInfo.idx }}、{{ problemInfo.title }}</p>
          </div>
        </template>
        <div v-if="isSubmit">
          <div style="margin: 10px;">
            选择语言：
            <el-select v-model="submitLang" placeholder="选择语言" style="width: 160px;">
              <el-option v-for="l in this.langList" :key="l.id" :label="l.des" :value="l.id" />
            </el-select>
          </div>
          <el-divider />
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
    <el-col :xs="24" :sm="24" :md="7">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <p class="title" style="font-size: 18px;">题目信息</p>
          </div>
        </template>
        <el-descriptions direction="vertical" :column="1" border>
          <el-descriptions-item label="时间限制"> {{ problemInfo.timeLimit }} ms</el-descriptions-item>
          <el-descriptions-item label="空间限制"> {{ problemInfo.memoryLimit }} MB</el-descriptions-item>
          <el-descriptions-item label="比对方式"> {{ problemInfo.type }} </el-descriptions-item>
          <el-descriptions-item label="出题人">
            <router-link class="rlink" :to="'/user/' + problemInfo.publisherUid">
              {{ problemInfo.publisher }}
            </router-link>
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
            查看题目
          </el-button>
          <el-button type="danger" @click="this.$router.push({
            path: '/contest/' + this.cid,
            query: {
              tab: 'problemList'
            }
          })">
            <el-icon class="el-icon--left">
              <Back />
            </el-icon>
            返回比赛
          </el-button>
          <el-button v-if="this.gid >= 2" type="warning" @click="this.$router.push('/problem/' + problemInfo.pid)">
            <el-icon class="el-icon--left">
              <Files />
            </el-icon>
            题库查看
          </el-button>
        </div>
      </el-card>
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios';
import monacoEditor from '@/components/monacoEditor.vue'

export default {
  name: "contestProblemView",
  data() {
    return {
      cid: 0,
      pid: 0,
      gid: 1,
      submitLang: null,
      langList: [],
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
        code: this.code,
        lang: this.submitLang
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('提交成功');
          this.isSubmit = false;
          this.code = '';
        }
        else {
          this.$message.error('提交失败' + res.data.message);
          if (res.data.refresh) {
            this.$router.push({
              path: '/contest/' + this.cid,
              query: { tab: 'problemList' }
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
        for (let l in this.$store.state.langList) {
          let lid = this.$store.state.langList[l].id;
          if ((1 << lid) & this.problemInfo.lang) {
            this.langList.push(this.$store.state.langList[l]);
            if (!this.submitLang)
              this.submitLang = lid;
            if (lid === this.$store.state.preferenceLang)
              this.submitLang = lid;
          }
        }
        if (!this.$store.state.preferenceLang)
          this.$message.info('可在编辑资料--个人信息中设置您的偏好语言');
        else if (this.submitLang !== this.$store.state.preferenceLang)
          this.$message.warning('本题无法用您的偏好语言提交');
      }
      else {
        this.$router.push({
          path: '/contest/' + this.cid,
          query: { tab: 'problemList' }
        });
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

.card-header {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 35px;
}

.title {
  margin: 0;
  font-size: 25px;
}
</style>