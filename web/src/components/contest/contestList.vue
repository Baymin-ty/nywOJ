<template>
  <div class="page-wrap page-wrap--sm">
    <el-card shadow="hover">
      <template #header>
        <div class="card-header card-header--wrap">
          <span class="card-title">比赛列表</span>
          <div class="card-header-right">
            <el-pagination small @current-change="handleCurrentChange"
              :current-page="currentPage" :page-size="20"
              layout="total, prev, pager, next" :total="total" hide-on-single-page />
            <el-button-group>
              <el-popconfirm v-if="gid >= 2" confirm-button-text="确认" cancel-button-text="取消"
                title="确认添加比赛?" @confirm="addContest">
                <template #reference>
                  <el-button type="success" size="small">
                    <el-icon class="el-icon--left"><Plus /></el-icon>添加比赛
                  </el-button>
                </template>
              </el-popconfirm>
              <el-button type="primary" size="small" @click="all">
                <el-icon class="el-icon--left"><Refresh /></el-icon>刷新
              </el-button>
            </el-button-group>
          </div>
        </div>
      </template>

      <div class="table-scroll">
        <el-table
          :data="contestList"
          height="600px"
          :header-cell-style="{ textAlign:'center', background:'#f5f7fa' }"
          :cell-style="{ textAlign:'center' }"
          v-loading="!finished"
          style="width:100%; min-width:600px"
        >
          <el-table-column prop="cid" label="#" width="60" />
          <el-table-column label="标题" min-width="220" align="left">
            <template #default="scope">
              <router-link class="rlink" :to="'/contest/'+scope.row.cid">{{ scope.row.title }}</router-link>
              <el-tag style="margin-left:8px" size="small" :type="tagType[scope.row.status]">
                {{ scope.row.status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="开始时间" min-width="160" class-name="hide-on-mobile">
            <template #default="scope">{{ scope.row.start }}</template>
          </el-table-column>
          <el-table-column label="时长" width="90">
            <template #default="scope">{{ scope.row.length }} min</template>
          </el-table-column>
          <el-table-column prop="type" label="类型" width="70" />
          <el-table-column label="公开" width="80" class-name="hide-on-mobile">
            <template #default="scope">
              <el-switch :model-value="scope.row.isPublic" size="small" disabled />
            </template>
          </el-table-column>
          <el-table-column label="参赛人数" width="90">
            <template #default="scope">
              <router-link class="rlink" :to="'/contest/player/'+scope.row.cid">
                × {{ scope.row.playerCnt }}
              </router-link>
            </template>
          </el-table-column>
          <el-table-column label="举办者" width="110" class-name="hide-on-mobile">
            <template #default="scope">
              <router-link class="rlink" :to="'/user/'+scope.row.host">{{ scope.row.hostName }}</router-link>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<script>
import axios from "axios";

export default {
  name: 'contestList',
  data() {
    return {
      contestList: [], total: 0, gid: 1, finished: false, currentPage: 1,
      tagType: { '未开始': '', '正在进行': 'danger', '等待测评': 'success', '已结束': 'info' },
    };
  },
  methods: {
    all() {
      this.finished = false;
      axios.post('/api/contest/getContestList', { pageId: this.currentPage })
        .then(res => {
          this.contestList = res.data.data.map(c => ({ ...c, isPublic: !!c.isPublic }));
          this.total = res.data.total;
          this.finished = true;
        }).catch(err => { this.$message.error('获取比赛列表失败 ' + err.message); });
    },
    handleCurrentChange(val) { this.currentPage = val; this.all(); },
    addContest() {
      axios.post('/api/contest/createContest').then(res => {
        if (res.status === 200)
          this.$router.push({ path: '/contest/' + res.data.cid, query: { tab: 'manageC' } });
        else this.$message.error('添加比赛失败 ' + res.data.message);
      });
    },
  },
  mounted() {
    this.gid = this.$store.state.gid;
    this.all();
  },
};
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-weight: bolder;
  color: #3f3f3f;
}
.card-title { font-size: 15px; }
.card-header-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.table-scroll { overflow-x: auto; }
</style>
