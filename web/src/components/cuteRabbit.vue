<template>
  <el-row>
    <el-col :span="12">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            Tiddar
            <el-divider direction="vertical"/>
            <el-col :span="3" class="switch">
              <el-switch
                  v-model="exSound"
                  size="large"
                  class="ml-2"
                  inline-prompt
                  style="--el-switch-on-color: #13ce66; --el-switch-off-color: #ff4949"
                  active-text="开启点击音效"
                  inactive-text="关闭点击音效"
              />
            </el-col>
            <el-divider direction="vertical"/>
            更新提示
            <el-col :span="3" class="switch">
              添加：
              <el-switch v-model="show_insert_info"/>
            </el-col>
            <el-col :span="3" class="switch">
              列表：
              <el-switch v-model="show_list_info"/>
            </el-col>
            <el-col :span="4" class="switch">
              点击数：
              <el-switch v-model="show_clickCnt_info"/>
            </el-col>
          </div>
        </template>
        <el-button style="height: 500px; width: 400px" round :disabled="!finished">
          <img v-show="flag" class="round" alt="Rabbit" @click="fun" src="../assets/rabbit-1.jpg">
          <img v-show="!flag" class="round" alt="Rabbit" src="../assets/rabbit-2.jpg">
        </el-button>
        <audio ref="hash">
          <source src="../assets/hash.mp3">
        </audio>
        <h1 class="rainbow"> 你戳了可爱兔兔 {{ cnt }} 下</h1>
      </el-card>
    </el-col>
    <el-col :span="12">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            戳可爱兔兔，测可爱列表
            <el-button type="primary" :disabled="!finished" @click="all">更新信息</el-button>
          </div>
        </template>
        <el-table v-loading="!this.info.length"
                  :data="info"
                  border
                  height="600px"
                  :row-class-name="tableRowClassName"
                  :cell-style="{ textAlign: 'center' }"
                  :header-cell-style="{ textAlign: 'center' }">
          <el-table-column prop="id" label="#" width="80px"/>
          <el-table-column prop="time" label="点击时间" width="auto"/>
          <el-table-column prop="userid" label="uid" width="80ox"/>
          <el-table-column prop="ip" label="IP" width="auto"/>
          <el-table-column prop="ip_loc" label="IP属地" width="auto"/>
        </el-table>
      </el-card>
    </el-col>
  </el-row>
</template>

<script>
import axios from "axios"
import {ElMessage} from 'element-plus'

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
      finished: 0,
      show_list_info: 0,
      show_clickCnt_info: 0,
      show_insert_info: 0,
      info: [],
      user_info: {},
    }
  },
  methods: {
    fun() {
      this.finished = 0;
      if (this.exSound)
        this.$refs.hash.play();
      this.add();
      // this.flag ^= 1;
      // setTimeout(() => {
      //   this.flag ^= 1;
      // }, 36);
    },
    all() {
      this.finished = 0;
      axios.get('/rabbit/all').then(res => {
        this.info = res.data;
        this.finished = 1;
        if (this.show_list_info) {
          ElMessage({
            message: '获取列表信息成功',
            type: 'success',
            duration: 1000,
          });
        }
      }).catch(err => {
        console.log("failed: " + err);
      });
      axios.get('/rabbit/getClickCnt', {
        params: {
          ip: this.user_info.ip
        }
      }).then(res => {
        this.cnt = res.data[0].cnt;
        if (this.show_clickCnt_info) {
          ElMessage({
            message: '获取个人点击数成功',
            type: 'success',
            duration: 1000,
          });
        }
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
          if (this.show_insert_info) {
            ElMessage({
              message: '添加点击信息成功',
              type: 'success',
              duration: 1000,
            });
          }
          this.all();
        }
      }).catch(err => {
        ElMessage({
          message: err.message,
          type: 'error',
          duration: 2000,
        });
        this.finished = 1;
      });
    },
    tableRowClassName(obj) {
      return (obj.row.ip === this.user_info.ip ? 'success' : '');
    },
  },
  mounted: async function () {
    this.finished = 0;
    ElMessage({
      message: '受到宇宙射线影响，自动更新被ty删了，请手动点击列表右上方按钮更新最新信息（点击兔兔的同时也会更新最新信息）',
      type: 'warning',
      duration: 5000,
      showClose: true
    })
    this.user_info = await getInfo();
    ElMessage({
      message: '获取个人信息成功',
      type: 'success',
      duration: 3000,
    });
    this.all();
  },
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.round {
  height: 480px;
  border-radius: 15px;
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

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
}

.switch {
  display: flex; /**/
  align-items: center;
  height: 20px;
}

</style>
