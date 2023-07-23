<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1200px">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          点击数排名
        </div>
      </template>
      <el-table v-loading="!finished" :data="info" height="600px" :row-style="{ height: '30px' }"
        :row-class-name="tableRowClassName" :cell-style="cellStyle" :header-cell-style="{ textAlign: 'center' }">
        <el-table-column label="#" type="index" width="80px" />
        <el-table-column prop="name" label="用户名" width="150px">
          <template #default="scope">
            <span style="cursor: pointer;" @click="this.$router.push('/user/' + scope.row.uid)"> {{ scope.row.name
            }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="clickCnt" label="点击次数" width="130px" />
        <el-table-column prop="motto" label="个人主页" width="auto">
          <template #default="scope">
            <span> {{ scope.row.motto }} </span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script>
import axios from "axios"
import { ElMessage } from 'element-plus'
import { getNameColor } from '@/assets/common'

export default {
  name: 'cuteRank',
  data() {
    return {
      finished: 0,
      uid: -1,
      info: [],
    }
  },
  methods: {
    all() {
      this.finished = false;
      axios.post('/api/rabbit/getRankInfo').then(res => {
        this.info = res.data.data;
        this.finished = true;
      }).catch(err => {
        this.finished = true;
        ElMessage({
          message: '获取最新排名失败' + err.message,
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
      if (columnIndex === 1) {
        style['font-weight'] = 500;
        style['color'] = getNameColor(row.gid, row.clickCnt);
        if (style['color'] === '#8e44ad')
          style['font-weight'] = 900;
      }
      return style;
    }
  },
  async mounted() {
    this.uid = this.$store.state.uid;
    this.all();
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
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