<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1200px">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          题目列表
          <el-pagination @current-change="handleCurrentChange" :current-page="currentPage" :page-size="20"
            layout="total, prev, pager, next" :total="total"></el-pagination>
          <el-button-group>
            <el-popconfirm v-if="this.gid >= 2" confirm-button-text="确认" cancel-button-text="取消" title="确认添加题目?"
              @confirm="addProblem">
              <template #reference>
                <el-button type="success">
                  <el-icon class="el-icon--left">
                    <Plus />
                  </el-icon>
                  添加题目
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
      <el-table :data="problemList" height="600px" :header-cell-style="{ textAlign: 'center' }"
        :cell-style="{ textAlign: 'center' }" v-loading="!finished">
        <el-table-column prop="pid" label="#" width="100px" />
        <el-table-column prop="title" label="标题" width="auto">
          <template #default="scope">
            <span class="rlink" @click="this.$router.push('/problem/' + scope.row.pid)">
              {{ scope.row.title }}
            </span>
            <el-icon id="hidden" v-if="!scope.row.isPublic">
              <Hide />
            </el-icon>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="AC/提交" width="150px">
          <template #default="scope">
            <span> {{ scope.row.acCnt }} / {{ scope.row.submitCnt }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="time" label="发布时间" width="200px" />
        <el-table-column prop="publisher" label="出题人" width="120px">
          <template #default="scope">
            <span class="rlink" @click="this.$router.push('/user/' + scope.row.publisherUid)">
              {{ scope.row.publisher }}
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
  name: 'problemList',
  data() {
    return {
      problemList: [],
      total: 0,
      gid: 1,
      currentPage: 1,
      finished: false
    }
  },
  methods: {
    all() {
      this.finished = false;
      axios.post('/api/problem/getProblemList', {
        pageId: this.currentPage
      }).then(res => {
        this.problemList = res.data.data;
        this.total = res.data.total;
        this.finished = true;
      }).catch(err => {
        ElMessage({
          message: '获取题目列表失败' + err.message,
          type: 'error',
          duration: 2000,
        });
      });
    },
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
    },
    addProblem() {
      axios.post('/api/problem/createProblem').then(res => {
        if (res.status === 200) {
          this.$router.push('/problem/edit/' + res.data.pid);
        } else {
          ElMessage({
            message: '添加题目失败' + res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
      });
    }
  },
  mounted() {
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