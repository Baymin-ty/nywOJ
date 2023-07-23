<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1200px">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          选手列表
          <el-pagination @current-change="handleCurrentChange" :current-page="currentPage" :page-size="20"
            layout="total, prev, pager, next" :total="total"></el-pagination>
          <el-button-group>
            <el-button v-if="this.gid >= 2" type="danger" @click="removePlayer" :disabled="!removeList.length">
              <el-icon class="el-icon--left">
                <Remove />
              </el-icon>
              踢出
            </el-button>
            <el-button v-if="this.gid >= 2" type="success" :disabled="!addName.length" @click="addPlayer">
              <el-icon class="el-icon--left">
                <Plus />
              </el-icon>
              添加
            </el-button>
            <el-input v-if="this.gid >= 2" v-model="addName" style="width: 150px;" placeholder="添加用户名"
              @keyup.enter="addPlayer" />
          </el-button-group>
        </div>
      </template>
      <el-table :data="playerList" height="600px" @selection-change="select" :header-cell-style="{ textAlign: 'center' }"
        :cell-style="{ textAlign: 'center' }" v-loading="!finished">
        <el-table-column v-if="this.gid >= 2" type="selection" min-width="10%" />
        <el-table-column prop="uid" label="uid" min-width="20%" />
        <el-table-column prop="name" label="用户名" min-width="70%">
          <template #default="scope">
            <span class="rlink" @click="this.$router.push('/user/' + scope.row.uid)">
              {{ scope.row.name }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script>
import axios from "axios"
import { ElMessage } from 'element-plus'

export default {
  name: 'problemPlayer',
  data() {
    return {
      playerList: [],
      removeList: [],
      total: 0,
      finished: false,
      gid: 1,
      cid: 0,
      currentPage: 1,
      addName: '',
    }
  },
  methods: {
    all() {
      this.finished = false;
      axios.post('/api/contest/getPlayerList', {
        cid: this.cid,
        pageId: this.currentPage
      }).then(res => {
        this.playerList = res.data.data;
        this.total = res.data.total;
        this.finished = true;
      }).catch(err => {
        ElMessage({
          message: '获取选手列表失败' + err.message,
          type: 'error',
          duration: 2000,
        });
      });
    },
    removePlayer() {
      axios.post('/api/contest/removePlayer', {
        list: this.removeList
      }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '删除选手成功',
            type: 'success',
            duration: 1000,
          });
        } else {
          ElMessage({
            message: '删除选手失败' + res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
      });
      this.all();
    },
    addPlayer() {
      axios.post('/api/contest/addPlayer', {
        cid: this.cid,
        name: this.addName
      }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '添加选手成功',
            type: 'success',
            duration: 1000,
          });
          this.addName = '';
        }
        else {
          ElMessage({
            message: res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
        this.all();
      });
    },
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
    },
    select(val) {
      this.removeList = val;
    }
  },
  mounted() {
    this.cid = this.$route.params.cid;
    this.gid = this.$store.state.gid;
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