<template>
  <el-row>
    <el-col :span="15">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            点击数排名
            <el-button type="primary" :disabled="!finished" @click="all">更新排名</el-button>
          </div>
        </template>
        <el-table v-loading="!finished"
                  :data="info"
                  border
                  height="600px"
                  :row-class-name="tableRowClassName"
                  :cell-style="{ textAlign: 'center' }"
                  :header-cell-style="{ textAlign: 'center' }">
          <el-table-column label="#" type="index" width="80px"/>
          <el-table-column prop="ip" label="IP" width="auto"/>
          <el-table-column prop="ip_loc" label="IP属地" width="auto"/>
          <el-table-column prop="cnt" label="点击次数" width="auto"/>
        </el-table>
      </el-card>
    </el-col>
    <el-col :span="9">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            实施可持续发展战略
            <el-select v-model="money" class="m-2" placeholder="Select">
              <el-option
                  v-for="item in options"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
              />
            </el-select>
          </div>
        </template>
        <img v-show="money===50" class="round" src="../assets/50.png">
        <img v-show="money===100" class="round" src="../assets/100.png">
        <img v-show="money===500" class="round" src="../assets/500.png">
      </el-card>
    </el-col>
  </el-row>
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
      finished: 0,
      user_info: {},
      info: [],
      money: 50,
      options: [{
        value: 50,
        label: '50 分',
      }, {
        value: 100,
        label: '100 分',
      }, {
        value: 500,
        label: '500 分',
      }],
    }
  },
  methods: {
    all() {
      this.finished = false;
      axios.get('/rabbit/getRankInfo').then(res => {
        this.info = res.data;
        this.finished = true;
        ElMessage({
          message: '获取最新排名成功',
          type: 'success',
          duration: 1000,
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
.round {
  height: 600px;
  border-radius: 15px;
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
