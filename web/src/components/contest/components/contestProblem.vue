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
        <span class="rlink" @click="this.$router.push('/contest/' + cid + '/problem/' + scope.row.idx)">
          {{ scope.row.title }}
        </span>
      </template>
    </el-table-column>
    <el-table-column prop="weight" label="满分" min-width="20%" />
    <el-table-column prop="publisher" label="出题人" min-width="20%">
      <template #default="scope">
        <span class="rlink" @click="this.$router.push('/user/' + scope.row.publisherUid)">
          {{ scope.row.publisher }}
        </span>
      </template>
    </el-table-column>
  </el-table>
</template>

<script>
import axios from "axios"
import { ElMessage } from 'element-plus'

export default {
  name: 'contestProblemList',
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
      }).catch(err => {
        ElMessage({
          message: '获取题目列表失败' + err.message,
          type: 'error',
          duration: 2000,
        });
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