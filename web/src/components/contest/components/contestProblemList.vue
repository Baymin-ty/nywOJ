<template>
  <el-table :data="problemList" height="600px" :header-cell-style="{ textAlign: 'center' }"
    :cell-style="{ textAlign: 'center' }" v-loading="!finished">
    <el-table-column type="index" min-width="10%">
      <template #header>
        <el-button circle @click="all" color="#626aef" plain>
          <el-icon>
            <Refresh />
          </el-icon>
        </el-button>
      </template>
    </el-table-column>
    <el-table-column prop="title" label="标题" min-width="50%">
      <template #default="scope">
        <router-link class="rlink" :to="'/contest/' + cid + '/problem/' + scope.row.idx">
          {{ scope.row.title }}
        </router-link>
      </template>
    </el-table-column>
    <el-table-column v-if="ctype === 'IOI'" prop="score" label="得分" min-width="15%" />
    <el-table-column prop="weight" label="满分" min-width="15%" />
    <el-table-column prop="publisher" label="出题人" min-width="20%">
      <template #default="scope">
        <router-link class="rlink" :to="'/user/' + scope.row.publisherUid">
          {{ scope.row.publisher }}
        </router-link>
      </template>
    </el-table-column>
  </el-table>
</template>

<script>
import axios from "axios"

export default {
  name: 'contestProblemList',
  props: {
    ctype: {
      type: String
    }
  },
  data() {
    return {
      problemList: [],
      gid: 1,
      cid: 0,
      finished: false
    }
  },
  methods: {
    all() {
      this.finished = false;
      axios.post('/api/contest/getPlayerProblemList', {
        cid: this.cid
      }).then(res => {
        this.problemList = res.data.data;
        this.finished = true;
        if (this.ctype === 'IOI') {
          axios.post('/api/contest/getSingleUserLastSubmission', {
            cid: this.cid,
            uid: this.$store.state.uid
          }).then(res => {
            for (let s of res.data.data) {
              this.problemList[s.idx - 1].score = Math.round(s.score * this.problemList[s.idx - 1].weight / 100);
              this.problemList[s.idx - 1].result = s.judgeResult;
            }
          });
        }
      }).catch(err => {
        this.$message.error('获取题目列表失败' + err.message);
      });
    },
  },
  mounted() {
    this.cid = this.$route.params.cid;
    this.gid = this.$store.state.gid;
    this.all();
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped></style>