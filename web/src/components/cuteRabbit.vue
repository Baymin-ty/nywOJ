<template>
  <el-row>
    <el-col :span="12" style="min-width: 400px">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            Tiddar
            <el-switch
                v-model="show_insert_info"
                size="large"
                class="ml-2"
                inline-prompt
                style="--el-switch-on-color: #13ce66; --el-switch-off-color: #ff4949"
                active-text="开启添加成功通知"
                inactive-text="关闭添加成功通知"
            />
          </div>
        </template>
        <el-button style="height: 500px; width: 400px" @click="fun" round :disabled="!finished">
          <img class="round" alt="Rabbit" src="../assets/rabbit.jpg">
        </el-button>
        <h1 class="rainbow"> 你戳了可爱兔兔 {{ cnt }} 下</h1>
      </el-card>
    </el-col>
    <el-col :span="12" style="min-width: 400px">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            戳可爱兔兔，测可爱列表
            <el-button type="primary" :disabled="!finished" @click="all">更新信息</el-button>
          </div>
        </template>
        <el-table v-loading="!finished"
                  :data="info"
                  border
                  height="600px"
                  :row-class-name="tableRowClassName"
                  :cell-style="{ textAlign: 'center' }"
                  :header-cell-style="{ textAlign: 'center' }">
          <el-table-column prop="id" label="#" width="80px"/>
          <el-table-column prop="time" label="点击时间" width="auto"/>
          <el-table-column prop="userid" label="uid" width="80px"/>
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
// import storage from '../sto/storageManage'
import bcrypt from 'bcryptjs'

const getInfo = () => {
  return axios.get('https://ip.useragentinfo.com/json').then((res) => {
    let ipInfo = {};
    ipInfo.ip = res.data.ip;
    ipInfo.country = res.data.country;
    ipInfo.province = res.data.province;
    ipInfo.city = res.data.city;
    if (ipInfo.country === "中国") ipInfo.country = "";
    if (ipInfo.province === ipInfo.city) ipInfo.province = "";
    return {
      ip: ipInfo.ip,
      ip_loc: ipInfo.country + ipInfo.province + ipInfo.city
    };
  })
}

export default {
  name: 'cuteRabbit',
  data() {
    return {
      cnt: "/",
      finished: 0,
      show_insert_info: 0,
      info: [],
      user_info: {},
    }
  },
  methods: {
    fun() {
      this.finished = 0;
      this.add();
    },
    all() {
      this.finished = 0;
      axios.get('/rabbit/all').then(res => {
        this.info = res.data;
      }).catch(err => {
        ElMessage({
          message: '获取列表信息失败' + err.message,
          type: 'error',
          duration: 2000,
        });
      });
      axios.get('/rabbit/getClickCnt', {
        params: {
          ip: this.user_info.ip
        }
      }).then(res => {
        this.cnt = res.data[0].cnt;
        this.finished = 1;
      }).catch(err => {
        ElMessage({
          message: '获取个人点击数失败' + err.message,
          type: 'error',
          duration: 2000,
        });
        this.finished = 1;
      });
    },
    add() {
      const key = bcrypt.hashSync(Math.floor(new Date().getTime() / 1000).toString() + "114514" + this.user_info.ip_loc, 1);
      axios.get('/rabbit/add', {
        params: {
          ip_loc: this.user_info.ip_loc,
          key: key,
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
        } else {
          ElMessage({
            message: '添加点击信息失败' + res.data.message,
            type: 'error',
            duration: 1000,
          });
          this.finished = 1;
        }
      }).catch(err => {
        ElMessage({
          message: '添加点击信息失败' + err.message,
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
  font-size: 40px;
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
</style>
