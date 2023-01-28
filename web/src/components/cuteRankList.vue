<template>
  <div style="width:1200px; text-align: center; margin: 0 auto">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          点击数排名
          <el-button type="primary" @click="all">更新排名</el-button>
        </div>
      </template>
      <el-table v-loading="!this.info.length"
                :data="info"
                border
                height="600px"
                :row-class-name="tableRowClassName"
                :cell-style="{ textAlign: 'center' }"
                :header-cell-style="{ textAlign: 'center' }">
        <el-table-column label="id" type="index" width="80px"/>
        <el-table-column prop="ip" label="IP" width="auto"/>
        <el-table-column prop="ip_loc" label="IP属地" width="auto"/>
        <el-table-column prop="cnt" label="点击次数" width="auto"/>
      </el-table>
    </el-card>
  </div>
</template>

<script>
import axios from "axios"
import {ElMessage} from 'element-plus'

const getIp = () => {
  return axios.get('https://ip.useragentinfo.com/json').then((response) => {
    return {
      ip: response.data.ip,
    };
  })
}

export default {
  name: 'cuteRank',
  data() {
    return {
      user_info: {},
      info: [],
    }
  },
  methods: {
    all() {
      axios.get('/rabbit/getRankInfo').then(res => {
        this.info = res.data;
        ElMessage({
          message: '获取最新排名成功',
          type: 'success',
          duration: '1000',
        });
      }).catch(err => {
        console.log("failed: " + err);
      });
    },
    tableRowClassName(obj) {
      return (obj.row.ip === this.user_info.ip ? 'success' : '');
    },
  },
  mounted: async function () {
    this.user_info = await getIp();
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
