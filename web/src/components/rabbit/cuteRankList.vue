<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1200px">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          点击数排名
          <el-pagination v-if="uid > 0" @current-change="handleCurrentChange" :current-page="currentPage"
            :page-size="20" layout="prev, pager, next" :total="total"></el-pagination>
        </div>
      </template>
      <el-table v-loading="!finished" :data="info" height="600px" :row-style="{ height: '45px' }"
        :row-class-name="tableRowClassName" :cell-style="cellStyle" :header-cell-style="{ textAlign: 'center' }">
        <el-table-column prop="rk" label="#" width="80px" />
        <el-table-column prop="name" label="用户名" width="200px">
          <template #default="scope">
            <div class="user-info">
              <img :src="scope.row.avatar" class="avatar" alt="avatar">
              <span class="username" @click="$router.push('/user/' + scope.row.uid)">
                {{ scope.row.name }}
              </span>
            </div>
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
      finished: false,
      total: 0,
      uid: 0,
      info: [],
      currentPage: 1,
    }
  },
  methods: {
    all() {
      this.finished = false;
      axios.post('/api/rabbit/getRankInfo', {
        pageId: this.currentPage
      }).then(res => {
        this.info = res.data.data;
        this.total = res.data.total;
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
      let style = {}
      style['textAlign'] = 'center',
        style['verticalAlign'] = 'middle',
        style['textAlign'] = 'center';
      if (columnIndex === 1) {
        style['font-weight'] = 500;
        style['color'] = getNameColor(row.gid, row.clickCnt);
        if (style['color'] === '#8e44ad')
          style['font-weight'] = 900;
      }
      return style;
    },
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
    },
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

.user-info {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.avatar {
  width: 25px;
  height: 25px;
  border-radius: 50%;
  object-fit: cover;
}

.username {
  cursor: pointer;
  margin-left: 10px;
}
</style>