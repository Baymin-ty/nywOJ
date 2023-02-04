<template>
  <el-row>
    <el-col :span="12" style="min-width: 400px">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            Tiddar (IP: {{ this.ip }} 用户名: {{ this.name }})
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
          <el-table-column prop="id" label="#" width="100px"/>
          <el-table-column prop="time" label="点击时间" width="200px"/>
          <el-table-column prop="uid" label="uid" width="60px"/>
          <el-table-column prop="name" label="用户名" width="auto"/>
          <el-table-column prop="ip" label="IP" width="auto"/>
        </el-table>
      </el-card>
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios'
import {ElMessage} from 'element-plus'

export default {
  name: 'cuteRabbit',
  data() {
    return {
      cnt: "/",
      finished: 0,
      show_insert_info: 0,
      info: [],
      ip: "/",
      uid: -1,
      name: "请登录",
      ok: true
    }
  },
  methods: {
    async fun() {
      await this.add();
      await this.all();
      this.getCnt();
    },
    all() {
      this.finished = 0;
      axios.get('/rabbit/all').then(res => {
        this.info = res.data.data;
        this.finished = 1;
      }).catch(err => {
        ElMessage({
          message: '获取列表信息失败' + err.message,
          type: 'error',
          duration: 2000,
        });
        this.finished = 1;
      });
    },
    getCnt() {
      if (this.uid === -1)
        return;
      axios.get('/rabbit/getClickCnt', {
        params: {
          uid: this.uid,
        }
      }).then(res => {
        this.cnt = res.data.data[0].clickCnt;
      }).catch(err => {
        ElMessage({
          message: '获取个人点击数失败' + err.message,
          type: 'error',
          duration: 2000,
        });
      });
    },
    add() {
      if (!localStorage.getItem('token')) {
        ElMessage({
          message: '请先登录后再点击',
          type: 'error',
          duration: 2000,
        });
        return;
      }
      axios.get('/rabbit/add', {
        params: {
          token: localStorage.getItem('token')
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
        } else {
          ElMessage({
            message: '添加点击信息失败' + res.data.message,
            type: 'error',
            duration: 1000,
          });
        }
      }).catch(err => {
        ElMessage({
          message: '添加点击信息失败' + err.message,
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
    this.ok = true;
    await axios.get('/rabbit/getUserIp', {}).then(res => {
      this.ip = res.data[0].ip;
    }).catch(err => {
      this.ok = false;
      ElMessage({
        message: '获取ip失败' + err.message,
        type: 'error',
        duration: 2000,
      });
    });
    if (!localStorage.getItem('token')) {
      ElMessage({
        message: '暂未登录',
        type: 'warning',
        duration: 2000,
      });
      this.ok = false;
    } else {
      await axios.get('/user/getUserInfo', {
        params: {
          token: localStorage.getItem('token')
        }
      }).then(res => {
        if (res.data.status === 200) {
          this.uid = res.data.uid;
          this.name = res.data.name;
        } else {
          if (res.data.status === 114514) {
            localStorage.removeItem('token');
            ElMessage({
              message: res.data.message,
              type: 'warning',
              duration: 3000,
            });
          } else {
            ElMessage({
              message: res.data.message,
              type: 'error',
              duration: 3000,
            });
          }
          this.ok = false;
        }
      }).catch(err => {
        ElMessage({
          message: '获取用户信息失败' + err.message,
          type: 'error',
          duration: 2000,
        });
        this.ok = false;
      });
    }
    if (this.ok) {
      ElMessage({
        message: '获取个人信息成功',
        type: 'success',
        duration: 2000,
      });
    } else {
      ElMessage({
        message: '获取个人信息异常',
        type: 'error',
        duration: 2000,
      });
    }
    this.all();
    this.getCnt();
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
