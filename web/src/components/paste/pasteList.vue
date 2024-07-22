<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1200px">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          剪贴板列表
          <el-pagination @current-change="handleCurrentChange" :current-page="currentPage" :page-size="20"
            layout="total, prev, pager, next" :total="total"></el-pagination>
          <el-button-group>
            <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认添加剪贴板?" @confirm="addPaste">
              <template #reference>
                <el-button type="success">
                  <el-icon class="el-icon--left">
                    <DocumentAdd />
                  </el-icon>
                  添加剪贴板
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
      <el-table :data="pasteList" height="600px" :header-cell-style="{ textAlign: 'center' }"
        :cell-style="{ textAlign: 'center' }" v-loading="!finished">
        <el-table-column prop="id" label="#" width="120px" />
        <el-table-column prop="mark" label="mark" width="150px" />
        <el-table-column prop="title" label="标题" width="auto">
          <template #default="scope">
            <router-link class="rlink" :to="'/paste/' + scope.row.mark">
              {{ scope.row.title }}
            </router-link>
            <el-icon id="hidden" v-if="!scope.row.isPublic">
              <Hide />
            </el-icon>
          </template>
        </el-table-column>
        <el-table-column prop="time" label="发布时间" width="200px" />
        <el-table-column prop="publisher" label="发布人" width="200px">
          <template #default="scope">
            <router-link class="rlink" :to="'/user/' + scope.row.uid">
              {{ scope.row.publisher }}
            </router-link>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script>
import axios from "axios"
import { ElMessage } from 'element-plus'
import qs from 'qs'

export default {
  name: 'pasteList',
  data() {
    return {
      pasteList: [],
      total: 0,
      currentPage: 1,
      finished: false,
      uid: null,
    }
  },
  methods: {
    all() {
      this.finished = false;
      let param = {}, url = location.pathname;
      if (this.uid) param.uid = this.uid;
      if (this.currentPage > 1)
        param.pageId = this.currentPage;
      let nurl = qs.stringify(param);
      if (nurl) url += ('?' + nurl);
      history.state.current = url;
      history.replaceState(history.state, null, url);
      axios.post('/api/common/getPasteList', {
        pageId: this.currentPage,
        uid: this.uid,
      }).then(res => {
        this.pasteList = res.data.data;
        this.total = res.data.total;
        this.finished = true;
      }).catch(err => {
        ElMessage({
          message: '获取剪贴板列表失败' + err.message,
          type: 'error',
          duration: 2000,
        });
      });
    },
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
    },
    addPaste() {
      axios.post('/api/common/addPaste').then(res => {
        if (res.status === 200) {
          this.$router.push('/paste/edit/' + res.data.mark);
        } else {
          ElMessage({
            message: '添加剪贴板失败' + res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
      });
    }
  },
  mounted() {
    if (this.$route.query.uid) this.uid = this.$route.query.uid;
    if (this.$route.query.pageId) this.currentPage = this.$route.query.pageId;
    this.all();
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.box-card {
  margin: 10px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
}
</style>