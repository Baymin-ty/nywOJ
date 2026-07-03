<template>
  <div class="discussion-page">
    <section class="discussion-hero">
      <div>
        <div class="eyebrow">Discussion</div>
        <h1>{{ pageTitle }}</h1>
        <p>{{ pageSubtitle }}</p>
      </div>
      <div class="hero-stat">
        <strong>{{ total }}</strong>
        <span>条讨论</span>
      </div>
    </section>

    <section class="discussion-toolbar">
      <el-input
        v-model="keyword"
        class="search"
        clearable
        placeholder="搜索标题"
        @keyup.enter="search"
        @clear="search"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <div class="toolbar-actions">
        <el-button type="primary" @click="search">
          <el-icon class="el-icon--left"><Search /></el-icon>
          搜索
        </el-button>
        <el-button v-if="!problemIdAll" type="success" @click="addDiscussion">
          <el-icon class="el-icon--left"><DocumentAdd /></el-icon>
          新建讨论
        </el-button>
        <el-button @click="all">
          <el-icon class="el-icon--left"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </section>

    <section class="discussion-list-panel" :class="{ 'has-problem-column': problemIdAll }" v-loading="!finished">
      <div class="list-heading">
        <span>标题</span>
        <span v-if="problemIdAll">关联题目</span>
        <span>回复</span>
        <span>发布人</span>
        <span>最后活动</span>
        <span>操作</span>
      </div>

      <el-empty v-if="finished && !discussionList.length" description="暂无讨论" />

      <article v-for="item in discussionList" :key="item.did" class="discussion-item">
        <div class="discussion-main">
          <div class="discussion-id">#{{ item.did }}</div>
          <div class="discussion-title-row">
            <router-link class="discussion-title rlink" :to="'/discussion/' + item.did">
              {{ item.title }}
            </router-link>
            <el-tag v-if="!item.isPublic" type="danger" effect="plain" size="small">
              <el-icon><Hide /></el-icon>
              隐藏
            </el-tag>
          </div>
          <div class="mobile-meta">
            <router-link class="rlink" :to="'/user/' + item.uid">{{ item.publisher }}</router-link>
            <span>{{ displayTime(item) }}</span>
          </div>
        </div>

        <div v-if="problemIdAll" class="problem-cell">
          <router-link v-if="item.pid" class="rlink" :to="'/problem/' + item.pid">
            #{{ item.pid }} {{ item.problemTitle || '' }}
          </router-link>
          <span v-else class="muted">全站</span>
        </div>

        <div class="reply-cell">
          <strong>{{ item.replyCnt || 0 }}</strong>
          <span>回复</span>
        </div>

        <router-link class="publisher-cell rlink" :to="'/user/' + item.uid">
          {{ item.publisher }}
        </router-link>

        <div class="time-cell">{{ displayTime(item) }}</div>

        <div class="action-cell">
          <el-button
            v-if="item.canEdit"
            link
            type="primary"
            @click="this.$router.push('/discussion/edit/' + item.did)"
          >
            编辑
          </el-button>
          <span v-else class="muted">-</span>
        </div>
      </article>

      <div class="pager" v-if="total > 0">
        <el-pagination
          @current-change="handleCurrentChange"
          :current-page="currentPage"
          :page-size="20"
          layout="total, prev, pager, next"
          :total="total"
        />
      </div>
    </section>
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
    pageSubtitle() {
      if (this.problemIdAll) return '集中查看所有题目相关的提问、题解交流和补充说明';
      if (this.pid) return '围绕这道题展开讨论，保留思路、疑问和细节';
      return '全站讨论、公告外的交流和问题记录';
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
  max-width: 1180px;
  padding: 16px 10px 28px;
}

.discussion-hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
  padding: 22px 24px;
  border: 1px solid #e4e9f2;
  border-radius: 8px;
  background: linear-gradient(135deg, #f8fbff 0%, #ffffff 58%, #f4fff8 100%);
  box-shadow: 0 12px 32px rgba(31, 45, 61, 0.08);
}

.eyebrow {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #3b82f6;
  text-transform: uppercase;
}

.discussion-hero h1 {
  margin: 0;
  font-size: 28px;
  line-height: 1.25;
  color: #1f2937;
  letter-spacing: 0;
}

.discussion-hero p {
  margin: 8px 0 0;
  color: #697386;
  line-height: 1.7;
}

.hero-stat {
  min-width: 118px;
  padding: 12px 16px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.78);
  text-align: center;
}

.hero-stat strong {
  display: block;
  font-size: 26px;
  line-height: 1.15;
  color: #2563eb;
}

.hero-stat span {
  font-size: 13px;
  color: #697386;
}

.discussion-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  padding: 14px;
  border: 1px solid #e4e9f2;
  border-radius: 8px;
  background: #ffffff;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.search {
  max-width: 420px;
}

.discussion-list-panel {
  position: relative;
  min-height: 320px;
  margin-top: 14px;
  border: 1px solid #e4e9f2;
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
}

.list-heading,
.discussion-item {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) 92px 140px 170px 78px;
  gap: 14px;
  align-items: center;
}

.has-problem-column .list-heading,
.has-problem-column .discussion-item {
  grid-template-columns: minmax(280px, 1fr) 150px 92px 140px 170px 78px;
}

.list-heading {
  padding: 12px 18px;
  border-bottom: 1px solid #edf1f7;
  background: #f8fafc;
  color: #7a8494;
  font-size: 12px;
  font-weight: 700;
}

.discussion-item {
  padding: 16px 18px;
  border-bottom: 1px solid #edf1f7;
  transition: background-color .18s ease, box-shadow .18s ease;
}

.discussion-item:hover {
  background: #fbfdff;
  box-shadow: inset 3px 0 0 #409eff;
}

.discussion-item:last-of-type {
  border-bottom: 0;
}

.discussion-main {
  min-width: 0;
}

.discussion-id {
  margin-bottom: 5px;
  font-size: 12px;
  font-weight: 700;
  color: #94a3b8;
}

.discussion-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.discussion-title {
  min-width: 0;
  color: #24324b;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.discussion-title:hover {
  color: #2d71d7;
}

.mobile-meta {
  display: none;
}

.problem-cell,
.publisher-cell,
.time-cell {
  min-width: 0;
  color: #697386;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reply-cell {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  width: fit-content;
  min-width: 64px;
  padding: 7px 10px;
  border-radius: 8px;
  background: #f0fdf4;
  color: #64748b;
}

.reply-cell strong {
  color: #16834a;
}

.reply-cell span {
  font-size: 12px;
}

.action-cell {
  text-align: center;
}

.pager {
  display: flex;
  justify-content: center;
  padding: 16px;
  border-top: 1px solid #edf1f7;
}

.muted {
  color: #909399;
}

.discussion-title-row :deep(.el-tag) {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .discussion-page {
    padding: 8px 0 18px;
  }

  .discussion-hero {
    flex-direction: column;
    align-items: stretch;
    padding: 18px;
  }

  .discussion-hero h1 {
    font-size: 24px;
  }

  .hero-stat {
    width: auto;
  }

  .discussion-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .toolbar-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .search {
    max-width: none;
  }

  .toolbar-actions .el-button {
    margin-left: 0;
  }

  .toolbar-actions .el-button:last-child:nth-child(3) {
    grid-column: 1 / -1;
  }

  .list-heading {
    display: none;
  }

  .discussion-item {
    grid-template-columns: 1fr auto;
    gap: 10px;
    align-items: start;
    padding: 15px;
  }

  .discussion-main {
    grid-column: 1 / -1;
  }

  .discussion-title {
    white-space: normal;
  }

  .mobile-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
    color: #8a94a6;
    font-size: 12px;
  }

  .problem-cell,
  .publisher-cell,
  .time-cell {
    display: none;
  }

  .reply-cell {
    justify-content: flex-start;
  }

  .action-cell {
    text-align: right;
  }
}
</style>
