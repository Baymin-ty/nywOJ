<template>
  <div class="discussion-page">
    <div class="discussion-panel">
      <div class="sub-header">
        <div class="sub-title-wrap">
          <span class="sub-title">{{ pageTitle }}</span>
          <span class="sub-count">{{ total }} 条</span>
        </div>
        <el-button-group class="sub-actions">
          <el-button v-if="!problemIdAll" type="success" plain @click="addDiscussion">
            <el-icon class="el-icon--left">
              <DocumentAdd />
            </el-icon>
            新建讨论
          </el-button>
          <el-button type="primary" plain @click="all">
            <el-icon class="el-icon--left">
              <Refresh />
            </el-icon>
            刷新
          </el-button>
        </el-button-group>
      </div>

      <div class="filter-bar">
        <el-input
          v-model="keyword"
          class="keyword-input"
          clearable
          placeholder="搜索标题"
          @keyup.enter="search"
          @clear="search"
        >
          <template #prefix>
            <el-icon>
              <Search />
            </el-icon>
          </template>
        </el-input>
        <el-button type="primary" @click="search">筛选</el-button>
        <el-button @click="resetSearch">重置</el-button>
      </div>

      <el-table
        class="discussion-table"
        :data="discussionList"
        :header-cell-style="{ textAlign: 'center' }"
        :cell-style="cellStyle"
        empty-text="暂无讨论"
        v-loading="!finished"
      >
        <el-table-column prop="did" label="#" width="86" align="center">
          <template #default="scope">
            <span class="cell-muted">#{{ scope.row.did }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="300" show-overflow-tooltip>
          <template #default="scope">
            <router-link class="discussion-title rlink" :to="'/discussion/' + scope.row.did">
              {{ scope.row.title }}
            </router-link>
            <el-tag v-if="!scope.row.isPublic" class="visibility-tag" type="danger" effect="plain" size="small">
              <el-icon>
                <Hide />
              </el-icon>
              隐藏
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="problemIdAll" label="关联题目" min-width="190" align="center" show-overflow-tooltip>
          <template #default="scope">
            <router-link v-if="scope.row.pid" class="rlink" :to="'/problem/' + scope.row.pid">
              #{{ scope.row.pid }} {{ scope.row.problemTitle || '' }}
            </router-link>
            <span v-else class="cell-muted">全站</span>
          </template>
        </el-table-column>
        <el-table-column prop="replyCnt" label="回复" width="90" align="center">
          <template #default="scope">
            <span class="reply-count">{{ scope.row.replyCnt || 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="publisher" label="发布人" width="150" align="center" show-overflow-tooltip>
          <template #default="scope">
            <router-link class="rlink" :to="'/user/' + scope.row.uid">
              {{ scope.row.publisher }}
            </router-link>
          </template>
        </el-table-column>
        <el-table-column label="最后活动" width="170" align="center" show-overflow-tooltip>
          <template #default="scope">
            <span class="cell-muted">{{ displayTime(scope.row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="92" align="center">
          <template #default="scope">
            <el-button
              v-if="scope.row.canEdit"
              link
              type="primary"
              @click="$router.push('/discussion/edit/' + scope.row.did)"
            >
              编辑
            </el-button>
            <span v-else class="cell-muted">-</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="sub-footer" v-if="total > 0">
        <el-pagination
          @current-change="handleCurrentChange"
          :current-page="currentPage"
          :page-size="20"
          layout="total, prev, pager, next"
          :total="total"
        />
      </div>
    </div>
  </div>
</template>

<script>
import axios from "axios"

export default {
  name: 'discussionList',
  data() {
    return {
      discussionList: [],
      total: 0,
      currentPage: 1,
      finished: false,
      pid: null,
      problemIdAll: false,
      uid: null,
      keyword: '',
    }
  },
  computed: {
    pageTitle() {
      if (this.problemIdAll) return '题目讨论';
      if (this.pid) return `题目 #${this.pid} 讨论`;
      return '讨论区';
    },
  },
  methods: {
    syncQuery() {
      const query = {};
      if (this.problemIdAll) query.problemId = 'all';
      else if (this.pid) query.problemId = this.pid;
      if (this.uid) query.publisherId = this.uid;
      if (this.keyword) query.keyword = this.keyword;
      if (this.currentPage > 1) query.page = this.currentPage;
      const path = this.$route.path.startsWith('/d') ? '/d' : '/discussion';
      this.$router.replace({ path, query });
    },
    all() {
      this.finished = false;
      this.syncQuery();
      axios.post('/api/discussion/getDiscussionList', {
        pageId: this.currentPage,
        pid: this.pid,
        problemId: this.problemIdAll ? 'all' : this.pid,
        uid: this.uid,
        publisherId: this.uid,
        keyword: this.keyword,
      }).then(res => {
        if (res.status === 200) {
          this.discussionList = res.data.data || [];
          this.total = res.data.total || 0;
        } else {
          this.$message.error('获取讨论列表失败' + res.data.message);
        }
      }).catch(err => {
        this.$message.error('获取讨论列表失败' + err.message);
      }).finally(() => {
        this.finished = true;
      });
    },
    search() {
      this.currentPage = 1;
      this.all();
    },
    resetSearch() {
      this.keyword = '';
      this.currentPage = 1;
      this.all();
    },
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
    },
    addDiscussion() {
      if (!this.$store.state.uid) {
        this.$store.state.reDirectTo = { path: '/discussion', query: this.$route.query };
        this.$router.push('/user/login');
        return;
      }
      axios.post('/api/discussion/addDiscussion', { pid: this.pid }).then(res => {
        if (res.status === 200) {
          this.$router.push('/discussion/edit/' + res.data.did);
        } else {
          this.$message.error('创建讨论失败' + res.data.message);
        }
      });
    },
    displayTime(item) {
      return item.lastReplyTime || item.updateTime || item.time || '-';
    },
    cellStyle({ columnIndex }) {
      return {
        textAlign: columnIndex === 1 ? 'left' : 'center',
        padding: '12px 0',
      };
    },
  },
  mounted() {
    const problemId = this.$route.query.problemId;
    if (problemId === 'all' || Number(problemId) === -1) this.problemIdAll = true;
    else if (problemId) this.pid = parseInt(problemId, 10);
    else if (this.$route.query.pid) this.pid = parseInt(this.$route.query.pid, 10);
    if (this.$route.query.publisherId) this.uid = parseInt(this.$route.query.publisherId, 10);
    else if (this.$route.query.uid) this.uid = parseInt(this.$route.query.uid, 10);
    if (this.$route.query.keyword) this.keyword = this.$route.query.keyword;
    if (this.$route.query.pageId || this.$route.query.page) {
      this.currentPage = parseInt(this.$route.query.pageId || this.$route.query.page, 10) || 1;
    }
    this.all();
  }
}
</script>

<style scoped>
.discussion-page {
  margin: 0 auto;
  max-width: 1320px;
}

.discussion-panel {
  padding: 16px 18px 14px;
  border: 1px solid #ebeef5;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04);
}

.sub-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.sub-title-wrap {
  display: inline-flex;
  align-items: baseline;
  gap: 10px;
}

.sub-title {
  color: #303133;
  font-size: 17px;
  font-weight: 800;
  white-space: nowrap;
}

.sub-count {
  padding: 2px 10px;
  border-radius: 999px;
  background: #f4f4f5;
  color: #909399;
  font-size: 12px;
  white-space: nowrap;
}

.sub-actions {
  flex-wrap: wrap;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  background: #f8fafc;
}

.filter-bar .el-button + .el-button {
  margin-left: 0;
}

.keyword-input {
  width: 320px;
  max-width: 100%;
}

.discussion-table {
  width: 100%;
}

.discussion-title {
  color: #303133;
  font-weight: 700;
}

.visibility-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 8px;
  vertical-align: 1px;
}

.reply-count {
  display: inline-flex;
  justify-content: center;
  min-width: 30px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f0f9eb;
  color: #529b2e;
  font-size: 12px;
  font-weight: 700;
}

.cell-muted {
  color: #606266;
  font-size: 12.5px;
}

.sub-footer {
  display: flex;
  justify-content: center;
  padding-top: 14px;
}

@media (max-width: 768px) {
  .discussion-page {
    width: 100%;
  }

  .discussion-panel {
    padding: 12px 10px;
    border-radius: 10px;
  }

  .sub-header {
    justify-content: center;
  }

  .filter-bar {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .keyword-input {
    grid-column: 1 / -1;
    width: 100%;
  }

  .filter-bar .el-button {
    width: 100%;
  }
}
</style>
