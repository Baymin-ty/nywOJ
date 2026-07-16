<template>
  <div class="contest-player-page">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          选手列表
          <el-pagination @current-change="handleCurrentChange" :current-page="currentPage" :page-size="20"
            layout="total, prev, pager, next" :total="total"></el-pagination>
          <el-button-group v-if="canManage">
            <el-button type="danger" @click="removePlayer" :disabled="!removeList.length">
              <el-icon class="el-icon--left">
                <Remove />
              </el-icon>
              踢出
            </el-button>
            <el-button type="success" :disabled="!addName.length" @click="addPlayer">
              <el-icon class="el-icon--left">
                <Plus />
              </el-icon>
              添加
            </el-button>
            <el-input v-model="addName" style="width: 150px;" placeholder="添加用户名"
              @keyup.enter="addPlayer" />
          </el-button-group>
        </div>
      </template>
      <el-table :data="playerList" height="600px" @selection-change="select" :header-cell-style="{ textAlign: 'center' }"
        :cell-style="{ textAlign: 'center' }" v-loading="!finished">
        <el-table-column v-if="canManage" type="selection" min-width="10%" />
        <el-table-column prop="uid" label="uid" min-width="20%" />
        <el-table-column prop="name" label="用户名" min-width="70%">
          <template #default="scope">
            <router-link class="rlink" :to="'/user/' + scope.row.uid">
              {{ scope.row.name }}
            </router-link>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script>
import axios from "axios"

export default {
  name: 'problemPlayer',
  data() {
    return {
      playerList: [],
      removeList: [],
      total: 0,
      finished: false,
      cid: 0,
      currentPage: 1,
      addName: '',
      // Server-computed manage flag (auth.manage from getContestInfo).
      // Cannot be derived from the client alone — requires checking ownership
      // + scoped manage.any grants which only the server has cached.
      canManage: false,
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
        this.$message.error('获取选手列表失败' + err.message);
      });
    },
    removePlayer() {
      axios.post('/api/contest/removePlayer', {
        cid: this.cid,
        list: this.removeList
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('删除选手成功');
        } else {
          this.$message.error('删除选手失败' + res.data.message);
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
          this.$message.success('添加选手成功');
          this.addName = '';
        }
        else {
          this.$message.error(res.data.message);
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
    // Ask the server who can manage this contest — the auth.manage flag in
    // the contest info reflects host+manage.self / manage.any-scoped grants.
    axios.post('/api/contest/getContestInfo', { cid: this.cid }).then((res) => {
      if (res.status === 200 && res.data && res.data.data && res.data.data.auth)
        this.canManage = !!res.data.data.auth.manage;
    }).catch(() => { /* keep canManage=false */ });
    this.all();
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.contest-player-page {
  max-width: 1200px;
  min-width: 0;
  margin: 0 auto;
  text-align: center;
}

.box-card {
  margin: 10px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
}

@media (max-width: 768px) {
  .box-card {
    margin: 0;
  }

  .card-header {
    height: auto;
    justify-content: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .card-header :deep(.el-pagination) {
    width: 100%;
    justify-content: center;
    flex-wrap: wrap;
  }

  .card-header :deep(.el-input) {
    width: min(100%, 240px) !important;
  }
}
</style>
