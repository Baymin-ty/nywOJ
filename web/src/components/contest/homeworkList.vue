<template>
  <div class="contest-page">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          作业列表
          <el-pagination @current-change="handleCurrentChange" :current-page="currentPage" :page-size="20"
            layout="total, prev, pager, next" :total="total"></el-pagination>
          <el-button-group>
            <el-popconfirm v-if="$can('contest.create')" confirm-button-text="确认" cancel-button-text="取消" title="确认添加作业?"
              @confirm="addHomework">
              <template #reference>
                <el-button type="success">
                  <el-icon class="el-icon--left">
                    <Plus />
                  </el-icon>
                  添加作业
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
      </template>
      <el-table :data="homeworkList" height="600px" :header-cell-style="{ textAlign: 'center' }"
        :cell-style="{ textAlign: 'center' }" v-loading="!finished">
        <el-table-column prop="cid" label="#" min-width="5%" />
        <el-table-column prop="title" label="标题" min-width="28%">
          <template #default="scope">
            <router-link class="rlink" :to="'/contest/' + scope.row.cid">
              {{ scope.row.title }}
            </router-link>
            <el-tag style="margin-left: 10px;" size="small" :type="tagType[scope.row.status]">
              {{ statusText(scope.row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="start" label="开始时间" min-width="20%" />
        <el-table-column label="截止时长" min-width="12%">
          <template #default="scope">
            <span> {{ scope.row.length }} min </span>
          </template>
        </el-table-column>
        <el-table-column prop="isPublic" label="是否公开" min-width="15%">
          <template #default="scope">
            <el-switch v-model="scope.row.isPublic" size="small" disabled active-text="公开" inactive-text="私有" />
          </template>
        </el-table-column>
        <el-table-column prop="playerCnt" label="参与人数" min-width="10%">
          <template #default="scope">
            <el-icon id="picon" size="13">
              <UserFilled />
            </el-icon>
            × {{ scope.row.playerCnt }}
          </template>
        </el-table-column>
        <el-table-column prop="host" label="发布者" min-width="15%">
          <template #default="scope">
            <router-link class="rlink" :to="'/user/' + scope.row.host">
              {{ scope.row.hostName }}
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
  name: 'homeworkList',
  data() {
    return {
      homeworkList: [],
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
    // 作业语境的状态文案（等待测评 = 已过 deadline，迟交窗口可能仍开放）
    statusText(status) {
      return { '正在进行': '进行中', '等待测评': '已截止' }[status] || status;
    },
    all() {
      this.finished = false;
      axios.post('/api/contest/getContestList', {
        pageId: this.currentPage,
        kind: 'homework',
      }).then(res => {
        this.homeworkList = res.data.data;
        for (const row of this.homeworkList) {
          row.isPublic = !!row.isPublic;
        }
        this.total = res.data.total;
        this.finished = true;
      }).catch(err => {
        this.$message.error('获取作业列表失败' + err.message);
      });
    },
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
    },
    addHomework() {
      axios.post('/api/contest/createContest', { format: 'homework' }).then(res => {
        if (res.status === 200) {
          this.$router.push({
            path: '/contest/' + res.data.cid,
            query: { tab: 'manageC' }
          });
        } else {
          this.$message.error('添加作业失败' + res.data.message);
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

<style scoped>
.box-card {
  margin: 10px;
}

.contest-page {
  text-align: center;
  margin: 0 auto;
  max-width: 1200px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
}

#picon {
  vertical-align: -2px;
}

@media (max-width: 768px) {
  .contest-page {
    width: 100%;
  }

  .box-card {
    margin: 0;
  }

  .card-header {
    justify-content: center;
  }
}
</style>
