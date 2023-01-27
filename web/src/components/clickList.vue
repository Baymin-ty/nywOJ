<template>
  <el-table :data="tableData">
    <el-table-column prop="date" label="点击时间" width="auto"/>
    <el-table-column prop="name" label="用户名" width="auto"/>
    <el-table-column prop="ip" label="IP" width="auto"/>
    <el-table-column prop="loc" label="IP属地" width="auto"/>
  </el-table>
  <h2>
    <el-button @click="addClickInfo">demo: 添加我的信息</el-button>
  </h2>
</template>

<script>

export default {
  name: 'clickList',
  data() {
    return {
      tableData: [{
        date: '1970-01-01',
        name: 'ty',
        ip: '0.0.0.0',
        loc: '江苏省苏州市',
      }, {
        date: '1970-01-02',
        name: 'ty',
        ip: '1.1.1.1',
        loc: '浙江省温州市',
      }, {
        date: '1970-01-03',
        name: 'ty',
        ip: '2.2.2.2',
        loc: '江苏省常州市',
      }, {
        date: '1970-01-04',
        name: 'ty',
        ip: '3.3.3.3',
        loc: '美国',
      }]
    }
  },
  methods: {
    addClickInfo() {
      this.axios.get('https://ip.useragentinfo.com/json').then((response) => {
        let ipInfo = {};
        ipInfo.ip = response.data.ip;
        ipInfo.country = response.data.country;
        ipInfo.province = response.data.province;
        ipInfo.city = response.data.city;
        if (ipInfo.country === "中国")
          ipInfo.country = "";
        if (ipInfo.province === ipInfo.city)
          ipInfo.province = "";
        const now = new Date();
        const curDate = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
        this.tableData.push({
          date: curDate, name: "guest", ip: ipInfo.ip,
          loc: ipInfo.country + ipInfo.province + ipInfo.city
        });
      });
    },
  },
}
</script>

<style scoped>

</style>