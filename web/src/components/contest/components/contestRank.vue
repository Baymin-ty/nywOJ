<template>
  {{ this.rankList }}
</template>

<script>
import axios from "axios"
import { ElMessage } from 'element-plus'

export default {
  name: 'rankList',
  data() {
    return {
      rankList: [],
      total: 0,
      gid: 1,
      cid: 0,
      currentPage: 1,
    }
  },
  methods: {
    all() {
      axios.post('/api/contest/getRank', {
        cid: this.cid
      }).then(res => {
        this.rankList = res.data.data;
      }).catch(err => {
        ElMessage({
          message: '获取比赛排行失败' + err.message,
          type: 'error',
          duration: 2000,
        });
      });
    },
  },
  mounted() {
    this.gid = this.$store.state.gid;
    this.cid = this.$route.params.cid;
    this.all();
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.box-card {
  height: 700px;
  margin: 10px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
}
</style>