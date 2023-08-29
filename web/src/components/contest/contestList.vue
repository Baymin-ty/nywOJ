<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1200px">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          比赛列表
          <el-pagination @current-change="handleCurrentChange" :current-page="currentPage" :page-size="20"
            layout="total, prev, pager, next" :total="total"></el-pagination>
          <el-button-group>
            <el-popconfirm v-if="this.gid >= 2" confirm-button-text="确认" cancel-button-text="取消" title="确认添加题目?"
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
      </template>
      <el-table :data="contestList" height="600px" :header-cell-style="{ textAlign: 'center' }"
        :cell-style="{ textAlign: 'center' }" v-loading="!finished">
        <el-table-column prop="cid" label="#" min-width="5%" />
        <el-table-column prop="title" label="标题" min-width="25%">
          <template #default="scope">
            <span class="rlink" @click="this.$router.push('/contest/' + scope.row.cid)"> {{ scope.row.title
            }}</span>
            <el-tag style="margin-left: 10px;" size="small" :type="tagType[scope.row.status]">{{ scope.row.status
            }}</el-tag>
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
        <el-table-column prop="type" label="类型" min-width="7%">
          <template #default="scope">
            <span> {{ scope.row.type }} </span>
          </template>
        </el-table-column>
        <el-table-column prop="isPublic" label="是否公开" min-width="15%">
          <template #default="scope">
            <el-switch v-model="scope.row.isPublic" size="small" disabled active-text="公开" inactive-text="私有" />
          </template>
        </el-table-column>
        <el-table-column prop="playerCnt" label="参赛人数" min-width="10%">
          <template #default="scope">
            <span class="rlink" @click="this.$router.push('/contest/player/' + scope.row.cid)">
              <el-icon size="13">
                <UserFilled />
              </el-icon>
              × {{ scope.row.playerCnt }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="host" label="举办者" min-width="15%">
          <template #default="scope">
            <span class="rlink" @click="this.$router.push('/user/' + scope.row.host)">
              {{ scope.row.hostName }}
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
  name: 'contestList',
  data() {
    return {
      contestList: [],
      total: 0,
      gid: 1,
      finished: false,
      currentPage: 1,
      tagType: {
        '未开始': '',
        '正在进行': 'danger',
        '等待测评': 'success',
        '已结束': 'info',
      }
    }
  },
  methods: {
    all() {
      this.finished = false;
      axios.post('/api/contest/getContestList', {
        pageId: this.currentPage
      }).then(res => {
        this.contestList = res.data.data;
        for (let i = 0; i < this.contestList.length; i++)
          this.contestList[i].isPublic = !!this.contestList[i].isPublic;
        this.total = res.data.total;
        this.finished = true;
      }).catch(err => {
        ElMessage({
          message: '获取比赛列表失败' + err.message,
          type: 'error',
          duration: 2000,
        });
      });
    },
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
    },
    addContest() {
      axios.post('/api/contest/createContest').then(res => {
        if (res.status === 200) {
          this.$router.push({
            path: '/contest/' + res.data.cid,
            query: { tab: 'manageC' }
          });
        } else {
          ElMessage({
            message: '添加比赛失败' + res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
      });
    },
  },
  async mounted() {
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