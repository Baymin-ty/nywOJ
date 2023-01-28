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
      <el-table v-loading="!this.info.length"
                :data="info"
                border
                height="500px"
                :row-class-name="tableRowClassName"
                :cell-style="{ textAlign: 'center' }"
                :header-cell-style="{ textAlign: 'center' }">
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
    return {
      userid: 1, ip: ipInfo.ip,
      ip_loc: ipInfo.country + ipInfo.province + ipInfo.city
    };
  })
}

const dateFormat = (x) => {
  x = x.toString();
  return x.length > 1 ? x : '0' + x;
}
const getCurTime = () => {
  const now = new Date();
  return now.getFullYear() + '-' + dateFormat(now.getMonth() + 1) + '-' + dateFormat(now.getDate())
      + ' ' + dateFormat(now.getHours()) + ':' + dateFormat(now.getMinutes()) + ':' + dateFormat(now.getSeconds());
}

export default {
  name: 'cuteRabbit',
  data() {
    return {
      cnt: "/",
      flag: 1,
      exSound: 0,
      info: [],
      user_info: {},
    }
  },
  methods: {
    fun() {
      if (this.exSound)
        this.$refs.hash.play();
      this.add();
      this.flag ^= 1;
      setTimeout(() => {
        this.flag ^= 1;
      }, 36);
    },
    all() {
      axios.get('/rabbit/all').then(res => {
        this.info = res.data;
      }).catch(err => {
        console.log("failed: " + err);
      });
      axios.get('/rabbit/getClickCnt', {
        params: {
          ip: this.user_info.ip
        }
      }).then(res => {
        this.cnt = res.data[0].cnt;
      }).catch(err => {
        console.log("failed: " + err);
      });
    },
    add() {
      axios.get('/rabbit/add', {
        params: {
          userid: this.user_info.userid,
          time: getCurTime(),
          ip: this.user_info.ip,
          ip_loc: this.user_info.ip_loc,
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
    tableRowClassName(obj) {
      return (obj.row.ip === this.user_info.ip ? 'success' : '');
    },
  },
  mounted: async function () {
    this.user_info = await getInfo();
    this.all();
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.round {
  width: 400px;
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
