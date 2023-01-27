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
      <el-table :data="info"
                border height="500px"
                :cell-style="{ textAlign: 'center' }"
                :header-cell-style="{ 'text-align': 'center' }">
        <el-table-column prop="id" label="#" width="80px"/>
        <el-table-column prop="time" label="点击时间" width="auto"/>
        <el-table-column prop="userid" label="uid" width="80ox"/>
        <el-table-column prop="ip" label="IP" width="auto"/>
        <el-table-column prop="ip_loc" label="IP属地" width="auto"/>
      </el-table>
    </el-col>
  </el-row>
</template>

<script>
import axios from "axios"

const dateFormat = (x) => {
  x = x.toString();
  return x.length > 1 ? x : '0' + x;
}
const getInfo = () => {
  return axios.get('https://ip.useragentinfo.com/json').then((response) => {
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
    const curDate = now.getFullYear() + '-' + dateFormat(now.getMonth() + 1) + '-' + dateFormat(now.getDate())
        + ' ' + dateFormat(now.getHours()) + ':' + dateFormat(now.getMinutes()) + ':' + dateFormat(now.getSeconds());
    return {
      time: curDate, userid: 1, ip: ipInfo.ip,
      ip_loc: ipInfo.country + ipInfo.province + ipInfo.city
    };
  })
}
export default {
  name: 'cuteRabbit',
  data() {
    let obj = this;
    return {
      cnt: obj.getCookie(),
      flag: 1,
      exSound: 0,
      info: [],
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
      this.add();
      this.all();
      document.cookie = ++this.cnt;
      this.flag ^= 1;
      setTimeout(() => {
        this.flag ^= 1;
      }, 36);
    },
    all() {
      this.axios.get('http://124.222.66.125:1234/rabbit/all').then(res => {
        this.info = res.data;
      }).catch(err => {
        console.log("failed: " + err);
      });
    },
    async add() {
      let x = await getInfo();
      axios.get('http://124.222.66.125:1234/rabbit/add', {
        params: {
          userid: x.userid,
          time: x.time,
          ip: x.ip,
          ip_loc: x.ip_loc,
        }
      }).then(res => {
        if (res.data.status === 200) {
          this.all()
        } else {
          this.$message({
            message: 'Failed',
            type: 'error'
          });
        }
      }).catch(err => {
        console.log("Failed" + err);
      });
    },
  },
  mounted: function () {
    this.all();
    setInterval(() => {
      this.all();
    }, 1000);
  }
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
