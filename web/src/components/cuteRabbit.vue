<template>
  <el-row>
    <el-col :span="12">
      <div>
        <img v-show="flag" class="round" alt="Rabbit" @click="fun" src="../assets/rabbit-1.jpg">
        <img v-show="!flag" class="round" alt="Rabbit" src="../assets/rabbit-2.jpg">
        <audio ref="hash">
          <source src="../assets/hash.mp3">
        </audio>
        <h1 class="rainbow"> 你戳了可爱兔兔 {{ cnt }} 下</h1>
      </div>
    </el-col>
    <el-col :span="12">
      <h2 style="float:left;">
        <el-switch
            v-model="exSound"
            size="large"
            class="ml-2"
            inline-prompt
            style="--el-switch-on-color: #13ce66; --el-switch-off-color: #ff4949"
            active-text="开启点击音效"
            inactive-text="关闭点击音效"
        />
        戳可爱兔兔，测可爱列表
      </h2>
      <el-table :data="tableData" border height="600px">
        <el-table-column prop="date" label="点击时间" width="auto"/>
        <el-table-column prop="name" label="用户名" width="auto"/>
        <el-table-column prop="ip" label="IP" width="auto"/>
        <el-table-column prop="loc" label="IP属地" width="auto"/>
      </el-table>
    </el-col>
  </el-row>
</template>

<script>
export default {
  name: 'cuteRabbit',
  data() {
    let obj = this;
    return {
      cnt: obj.getCookie(),
      flag: 1,
      exSound: 0,
      tableData: [{
        date: '1145-1-4',
        name: 'ztmf',
        ip: '1.1.4.5',
        loc: '火星',
      }, {
        date: '1970-1-4',
        name: 'ty',
        ip: '3.3.3.3',
        loc: '美国',
      }, {
        date: '1970-1-3',
        name: 'ty',
        ip: '2.2.2.2',
        loc: '江苏省常州市',
      }, {
        date: '1970-1-2',
        name: 'ty',
        ip: '1.1.1.1',
        loc: '浙江省温州市',
      },
        {
          date: '1970-1-1',
          name: 'ty',
          ip: '0.0.0.0',
          loc: '江苏省苏州市',
        },],
    }
  },
  methods: {
    getCookie() {
      const str = document.cookie;
      if (!str.length || str.length > 10)
        return 0;
      for (let i = 0, len = str.length; i < len; i++) {
        if (str[i] < '0' + (!i) || str[i] > '9')
          return 0;
      }
      return str;
    },
    fun() {
      if (this.exSound)
        this.$refs.hash.play();
      this.addClickInfo();
      document.cookie = ++this.cnt;
      // this.flag ^= 1;
      // setTimeout(() => {
      //   this.flag ^= 1;
      // }, 36);
    },
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
        const curDate = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate()
            + ' ' + now.getHours() + ':' + now.getMinutes() + ':' + now.getSeconds();
        this.tableData.unshift({
          date: curDate, name: "guest", ip: ipInfo.ip,
          loc: ipInfo.country + ipInfo.province + ipInfo.city
        });
      });
    },
  },
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.round {
  width: 500px;
  border-radius: 36px;
}

.rainbow {
  margin: 10px;
  font-size: 60px;
  background-image: linear-gradient(92deg, rgb(38, 243, 93) 0%, rgb(254, 171, 58) 100%);
  color: rgb(38, 82, 243);
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-weight: 600;
}
</style>
