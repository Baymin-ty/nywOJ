<template>
  <el-table :data="problemList" height="600px" :header-cell-style="{ textAlign: 'center' }"
    :cell-style="{ textAlign: 'center' }">
    <el-table-column prop="idx" label="#" min-width="10%" />
    <el-table-column prop="title" label="标题" min-width="50%">
      <template #default="scope">
        <span class="rlink" @click="this.$router.push('/contest/' + cid + '/problem/' + scope.row.idx)">
          {{ scope.row.title }}</span>
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
    }
  },
  methods: {
    all() {
      axios.post('/api/contest/getPlayerProblemList', {
        cid: this.cid
      }).then(res => {
        this.problemList = res.data.data;
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