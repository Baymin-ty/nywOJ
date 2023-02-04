<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1200px">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          点击数排名
          <el-button type="primary" :disabled="!finished" @click="all">更新排名</el-button>
        </div>
      </template>
      <el-table v-loading="!finished"
                :data="info"
                border
                height="600px"
                :row-class-name="tableRowClassName"
                :cell-style="{ textAlign: 'center' }"
                :header-cell-style="{ textAlign: 'center' }">
        <el-table-column label="#" type="index" width="80px"/>
        <el-table-column prop="uid" label="uid" width="auto"/>
        <el-table-column prop="name" label="用户名" width="auto"/>
        <el-table-column prop="clickCnt" label="点击次数" width="auto"/>
      </el-table>
    </el-card>
  </div>
</template>

<script>
import axios from "axios"
import {ElMessage} from 'element-plus'

export default {
  name: 'cuteRank',
  data() {
    return {
      finished: 0,
      uid: -1,
      info: [],
    }
  },
  methods: {
    all() {
      this.finished = false;
      axios.get('/rabbit/getRankInfo').then(res => {
        this.info = res.data.data;
        this.finished = true;
        ElMessage({
          message: '获取最新排名成功',
          type: 'success',
          duration: 1000,
        });
      }).catch(err => {
        this.finished = true;
        ElMessage({
          message: '获取最新排名失败' + err.message,
          type: 'error',
          duration: 2000,
        });
      });
    },
    tableRowClassName(obj) {
      return (obj.row.uid === this.uid ? 'success' : '');
    },
  },
  mounted: async function () {
    await axios.get('/user/getUserInfo', {
      params: {
        token: localStorage.getItem('token')
      }
    }).then(res => {
      if (res.data.status === 200) {
        this.uid = res.data.uid;
      }
    });
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