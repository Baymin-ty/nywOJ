<template>
  <div style="width:1200px; text-align: center; margin: 0 auto">
    <el-table :data="info"
              border
              height="500px"
              :cell-style="{ textAlign: 'center' }"
              :header-cell-style="{ textAlign: 'center' }"
              type="index">
      <el-table-column label="id" type="index" width="80px"/>
      <el-table-column prop="ip" label="IP" width="auto"/>
      <el-table-column prop="ip_loc" label="IP属地" width="auto"/>
      <el-table-column prop="cnt" label="点击次数" width="auto"/>
    </el-table>
  </div>
</template>

<script>
import axios from "axios"

export default {
  name: 'cuteRank',
  data() {
    return {
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
  },
  mounted: function () {
    this.all();
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>

</style>
