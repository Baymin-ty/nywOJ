<template>
  <div style="margin: auto;max-width: 1500px;">
    <el-row>
      <el-col :xs="24" :sm="24" :md="9">
        <el-card class="box-card" shadow="hover" style="text-align: center;">
          <template #header>
            <div class="card-header">
              Tiddar (uid: {{ this.uid }} 用户名: {{ this.name }})
            </div>
          </template>
          <el-button style="height: 500px; width: 350px;" @click="add()" round :disabled="!finished">
            <img class="round" :alt="pic[opt].name" :src="pic[opt].loc">
          </el-button>
          <h1 class="rainbow" style="font-size: 35px;">
            <span @click="opt = (opt + 1) % tot">
              你戳了兔兔 {{ cnt }} 下
            </span>
          </h1>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="24" :md="15">
        <el-card class="box-card" shadow="hover">
          <template #header>
            <div class="card-header">
              戳可爱兔兔，测可爱列表
              <el-button type="primary" :disabled="!finished" @click="all">
                <el-icon class="el-icon--left">
                  <Refresh />
                </el-icon>
                更新信息
              </el-button>
            </div>
          </template>
          <el-table v-loading="!finished" :data="info" height="600px" :row-class-name="tableRowClassName"
            :cell-style="cellStyle" :header-cell-style="{ textAlign: 'center' }">
            <el-table-column prop="id" label="#" min-width="15%" />
            <el-table-column prop="time" label="点击时间" min-width="25%" />
            <el-table-column prop="name" label="用户名" min-width="15%">
              <template #default="scope">
                <span style="cursor: pointer;" @click="this.$router.push('/user/' + scope.row.uid)">
                  {{ scope.row.name }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="ip" label="IP" min-width="20%" />
            <el-table-column prop="iploc" label="IP属地" min-width="25%" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script>
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { getNameColor } from '@/assets/common'

export default {
  name: 'cuteRabbit',
  data() {
    return {
      cnt: "/",
      finished: 0,
      info: [],
      uid: 0,
      name: "请登录",
      ok: true,
      opt: 0,
      tot: 3,
      pic: [
        {
          name: '兔兔',
          loc: require('@/assets/rabbit.jpg')
        },
        {
          name: '兔兔(拟人)',
          loc: require('@/assets/nrabbit.jpg')
        },
        {
          name: '龙龙',
          loc: require('@/assets/longlong.jpg')
        }
      ]
    }
  },
  methods: {
    all() {
      this.finished = 0;
      axios.post('/api/rabbit/all').then(res => {
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
      axios.post('/api/rabbit/getClickCnt').then(res => {
        this.cnt = res.data.clickCnt;
      }).catch(err => {
        ElMessage({
          message: '获取个人点击数失败' + err.message,
          type: 'error',
          duration: 2000,
        });
      });
    },
    async add() {
      await axios.post('/api/rabbit/add').then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '添加点击信息成功',
            type: 'success',
            duration: 1000,
          });
          this.all();
          this.getCnt();
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
    cellStyle({ row, columnIndex }) {
      let style = {};
      style['textAlign'] = 'center';
      if (columnIndex === 2) {
        style['font-weight'] = 500;
        style['color'] = getNameColor(row.gid, row.clickCnt);
        if (style['color'] === '#8e44ad')
          style['font-weight'] = 900;
      }
      return style;
    }
  },
  mounted: function () {
    this.uid = this.$store.state.uid;
    this.name = this.$store.state.name;
    this.getCnt();
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

a {
  color: #2d8cf0 !important;
  background: 0 0;
  text-decoration: none;
  outline: 0;
  cursor: pointer;
  font-weight: 500;
}
</style>
