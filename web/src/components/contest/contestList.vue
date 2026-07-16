<template>
  <div class="contest-page">
    <div class="sub-header">
      <span class="sub-title">比赛列表</span>
      <el-pagination @current-change="handleCurrentChange" :current-page="currentPage" :page-size="20"
        layout="total, prev, pager, next" :total="total"></el-pagination>
      <el-button-group>
        <el-popconfirm v-if="$can('contest.create')" confirm-button-text="确认" cancel-button-text="取消" title="确认添加比赛?"
          @confirm="addContest">
          <template #reference>
            <el-button type="success">
              <el-icon class="el-icon--left">
                <Plus />
              </el-icon>
              添加比赛
            </el-button>
          </template>
        </el-popconfirm>
        <el-button type="primary" @click="all">
          <el-icon class="el-icon--left">
            <Refresh />
          </el-icon>
          刷新
        </el-button>
      </el-button-group>
    </div>
    <el-table :data="contestList" :header-cell-style="{ textAlign: 'center' }"
        :cell-style="cellStyle" empty-text="暂无比赛" v-loading="!finished">
        <el-table-column prop="cid" label="#" min-width="5%" />
        <el-table-column prop="title" label="标题" min-width="25%">
          <template #default="scope">
            <router-link class="rlink" :to="'/contest/' + scope.row.cid">
              {{ scope.row.title }}
            </router-link>
            <el-tag style="margin-left: 10px;" size="small" :type="tagType[scope.row.status]">
              {{ scope.row.status }}
            </el-tag>
            <el-tag class="state-tag" size="small" :type="ratingStatusType(scope.row)" effect="plain">
              {{ ratingStatusText(scope.row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="start" label="开始时间" min-width="20%">
          <template #default="scope">
            <span> {{ scope.row.start }} </span>
          </template>
        </el-table-column>
        <el-table-column prop="length" label="时长" min-width="12%">
          <template #default="scope">
            <span> {{ scope.row.length }} min </span>
          </template>
        </el-table-column>
        <el-table-column prop="type" label="类型" min-width="10%">
          <template #default="scope">
            <span> {{ scope.row.type }} </span>
          </template>
        </el-table-column>
        <el-table-column prop="isPublic" label="是否公开" min-width="7%">
          <template #default="scope">
            <el-tag size="small" :type="scope.row.isPublic ? 'success' : 'info'" effect="plain" round>
              {{ scope.row.isPublic ? '公开' : '私有' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="playerCnt" label="参赛人数" min-width="8%">
          <template #default="scope">
            <router-link class="rlink" :to="'/contest/player/' + scope.row.cid">
              <el-icon id="picon" size="13">
                <UserFilled />
              </el-icon>
              × {{ scope.row.playerCnt }}
            </router-link>
          </template>
        </el-table-column>
        <el-table-column prop="host" label="举办者" min-width="15%">
          <template #default="scope">
            <router-link class="rlink" :to="'/user/' + scope.row.host">
              {{ scope.row.hostName }}
            </router-link>
          </template>
        </el-table-column>
      </el-table>
  </div>
</template>

<script>
import axios from "axios"

export default {
  name: 'contestList',
  data() {
    return {
      contestList: [],
      total: 0,
      finished: false,
      currentPage: 1,
      tagType: {
        '未开始': 'primary',
        '正在进行': 'danger',
        '等待测评': 'success',
        '已结束': 'info',
      }
    }
  },
  methods: {
    cellStyle() {
      return { textAlign: 'center', padding: '14px 0' };
    },
    all() {
      this.finished = false;
      let url = location.pathname;
      if (this.currentPage > 1) url += '?pageId=' + this.currentPage;
      history.state.current = url;
      history.replaceState(history.state, null, url);
      axios.post('/api/contest/getContestList', {
        pageId: this.currentPage
      }).then(res => {
        this.contestList = res.data.data;
        for (let i = 0; i < this.contestList.length; i++) {
          this.contestList[i].isPublic = !!this.contestList[i].isPublic;
          this.contestList[i].ratingEnabled = !!this.contestList[i].ratingEnabled;
        }
        this.total = res.data.total;
        this.finished = true;
      }).catch(err => {
        this.$message.error('获取比赛列表失败' + err.message);
      });
    },
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
    },
    ratingStatusText(row) {
      if (row && row.ratingStatus && row.ratingStatus.label) return row.ratingStatus.label;
      return row && row.ratingEnabled ? 'Rated' : 'Unrated';
    },
    ratingStatusType(row) {
      return row && row.ratingStatus && row.ratingStatus.type
        ? row.ratingStatus.type
        : (row && row.ratingEnabled ? 'warning' : 'info');
    },
    addContest() {
      axios.post('/api/contest/createContest').then(res => {
        if (res.status === 200) {
          this.$router.push({
            path: '/contest/' + res.data.cid,
            query: { tab: 'manageC' }
          });
        } else {
          this.$message.error('添加比赛失败' + res.data.message);
        }
      });
    },
  },
  async mounted() {
    const pageId = parseInt(this.$route.query.pageId, 10);
    if (Number.isInteger(pageId) && pageId > 1) this.currentPage = pageId;
    this.all();
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.contest-page {
  text-align: center;
  margin: 0 auto;
  max-width: 1400px;
}

.sub-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding-bottom: 14px;
  margin-bottom: 14px;
  border-bottom: 1px solid #ebeef5;
}

.sub-title {
  font-weight: bolder;
  color: #3f3f3f;
  white-space: nowrap;
}

#picon {
  vertical-align: -2px;
}

.state-tag {
  margin-left: 8px;
}

@media (max-width: 768px) {
  .contest-page {
    width: 100%;
  }

  .sub-header {
    flex-wrap: wrap;
    justify-content: center;
  }

  .sub-header :deep(.el-pagination) {
    width: 100%;
    justify-content: center;
    flex-wrap: wrap;
  }
}
</style>
