<template>
  <div style="width:1200px; text-align: center; margin: 0 auto">
    <el-table v-loading="!this.info.length"
              :data="info"
              border
              height="500px"
              :row-class-name="tableRowClassName"
              :cell-style="{ textAlign: 'center' }"
              :header-cell-style="{ textAlign: 'center' }">
      <el-table-column label="id" type="index" width="80px"/>
      <el-table-column prop="ip" label="IP" width="auto"/>
      <el-table-column prop="ip_loc" label="IP属地" width="auto"/>
      <el-table-column prop="cnt" label="点击次数" width="auto"/>
    </el-table>
  </div>
</template>

<script>
import axios from "axios"

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

</style>
