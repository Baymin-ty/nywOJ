<template>
  <div class="leaderboard-page">
    <div class="lb-header">
      <div class="lb-heading">
        <el-icon class="lb-trophy"><Trophy /></el-icon>
        <span class="lb-title">用户榜</span>
      </div>
      <div class="lb-tools">
        <el-radio-group v-model="sortBy" size="small" @change="switchSort">
          <el-radio-button value="acceptedProblemCount">AC 题数</el-radio-button>
          <el-radio-button value="rating">积分</el-radio-button>
          <el-radio-button value="clickCnt">点击数</el-radio-button>
        </el-radio-group>
        <el-button size="small" plain @click="all">
          <el-icon class="el-icon--left"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </div>

    <div v-loading="loading" class="lb-list">
      <div
        v-for="row in users"
        :key="row.uid"
        class="lb-row"
        :class="{ top: isTop3(row) }"
      >
          <span class="lb-rank" :class="medalClass(row)">
            <el-icon v-if="isTop3(row)"><Trophy /></el-icon>
            <span>{{ row.rank || '-' }}</span>
          </span>
          <el-avatar :size="42" shape="square" :src="row.avatar" class="lb-avatar" />
          <div class="lb-identity">
            <router-link class="rlink lb-name" :to="userProfilePath(row.name)">
              {{ row.nickname || row.name }}
            </router-link>
            <div class="lb-sub">
              @{{ row.name }}<span v-if="row.bio"> · {{ row.bio }}</span>
            </div>
            <div v-if="row.mottoExcerpt" class="lb-motto">{{ row.mottoExcerpt }}</div>
          </div>
          <div class="lb-stats">
            <div class="lb-stat">
              <div class="lb-stat-val lb-ac" :class="{ primary: sortBy === 'acceptedProblemCount' }">
                {{ row.acceptedProblemCount || 0 }}
              </div>
              <div class="lb-stat-label">AC</div>
            </div>
            <div class="lb-stat lb-rating-stat">
              <span class="rating-pill" :class="{ primary: sortBy === 'rating' }" :style="{
                color: ratingTier(row.rating).color,
                backgroundColor: ratingTier(row.rating).bg,
                borderColor: ratingTier(row.rating).color,
              }">
                <strong>{{ row.rating || 0 }}</strong>
                <small>{{ ratingTier(row.rating).label }}</small>
              </span>
              <el-tooltip v-if="row.ratingCacheMismatch && $can('user.role.admin')" content="缓存与有效历史不一致" placement="top">
                <el-tag class="rating-cache-tag" type="warning" size="small">!</el-tag>
              </el-tooltip>
            </div>
            <div class="lb-stat">
              <div class="lb-stat-val lb-click" :class="{ primary: sortBy === 'clickCnt' }">
                {{ row.clickCnt || 0 }}
              </div>
              <div class="lb-stat-label">点击</div>
            </div>
          </div>
        </div>

      <el-empty v-if="!loading && !users.length" description="暂无用户" />
    </div>

    <div class="pager">
      <el-pagination @current-change="handleCurrentChange" :current-page="currentPage" :page-size="pageSize"
        layout="total, prev, pager, next" :total="total" />
    </div>
  </div>
</template>

<script>
import axios from "axios";
import { getRatingTier, userProfilePath } from '@/assets/common';

export default {
  name: 'userList',
  data() {
    return {
      users: [],
      total: 0,
      currentPage: 1,
      pageSize: 50,
      sortBy: 'acceptedProblemCount',
      loading: false,
    };
  },
  methods: {
    userProfilePath,
    updateUrl() {
      const query = {};
      if (this.currentPage > 1) query.pageId = String(this.currentPage);
      if (this.sortBy !== 'acceptedProblemCount') query.sortBy = this.sortBy;
      this.$router.replace({ path: this.$route.path, query });
    },
    all() {
      this.loading = true;
      this.updateUrl();
      axios.post('/api/user/getUserList', {
        pageId: this.currentPage,
        pageSize: this.pageSize,
        sortBy: this.sortBy,
      }).then(res => {
        if (res.status === 200) {
          this.users = res.data.data || [];
          this.total = res.data.total || 0;
        } else {
          this.$message.error(res.data.message || '获取用户榜失败');
        }
      }).catch(err => {
        this.$message.error('获取用户榜失败' + err.message);
      }).finally(() => {
        this.loading = false;
      });
    },
    switchSort() {
      this.currentPage = 1;
      this.all();
    },
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
    },
    isTop3(row) {
      return row.rank >= 1 && row.rank <= 3;
    },
    medalClass(row) {
      return { 1: 'gold', 2: 'silver', 3: 'bronze' }[row.rank] || '';
    },
    ratingTier(rating) {
      return getRatingTier(rating);
    },
  },
  mounted() {
    const query = this.$route.query || {};
    if (['acceptedProblemCount', 'rating', 'clickCnt'].includes(query.sortBy)) this.sortBy = query.sortBy;
    else if (this.$store.state.serverPreference && this.$store.state.serverPreference.misc
      && this.$store.state.serverPreference.misc.sortUserByRating) this.sortBy = 'rating';
    if (query.pageId) this.currentPage = Math.max(1, parseInt(query.pageId, 10) || 1);
    this.all();
  },
};
</script>

<style scoped>
.leaderboard-page {
  max-width: 1400px;
  margin: 0 auto;
  text-align: left;
}

.lb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 24px;
  padding-bottom: 14px;
  margin-bottom: 4px;
  border-bottom: 1px solid #ebeef5;
}

.lb-heading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.lb-trophy {
  color: #f7b500;
  font-size: 20px;
}

.lb-title {
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}

.lb-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.lb-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 10px;
  border-radius: 8px;
  transition: background 0.15s;
}

.lb-row + .lb-row {
  border-top: 1px solid #f2f3f5;
}

.lb-row:hover {
  background: #f5f7fa;
}

.lb-row.top {
  background: linear-gradient(90deg, #fffdf3 0%, transparent 55%);
}

.lb-rank {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  flex: 0 0 auto;
  min-width: 40px;
  height: 26px;
  padding: 0 9px;
  border-radius: 999px;
  color: #909399;
  font-weight: 700;
  font-size: 13px;
}

.lb-rank.gold {
  background: #fff5d6;
  color: #b8860b;
}

.lb-rank.silver {
  background: #eef1f5;
  color: #6b7785;
}

.lb-rank.bronze {
  background: #f7e8da;
  color: #b5703a;
}

.lb-avatar {
  flex: 0 0 auto;
}

.lb-identity {
  flex: 1 1 auto;
  min-width: 0;
}

.lb-name {
  font-weight: 600;
  word-break: break-all;
}

.lb-sub {
  margin-top: 2px;
  color: #909399;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lb-motto {
  margin-top: 3px;
  color: #a8abb2;
  font-size: 12px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lb-stats {
  display: flex;
  align-items: center;
  gap: 34px;
  flex: 0 0 auto;
}

.lb-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 72px;
}

.lb-stat-val {
  font-weight: 700;
  font-size: 15px;
  color: #606266;
}

.lb-stat-val.primary {
  color: #19be6b;
}

.lb-stat-label {
  font-size: 11px;
  color: #c0c4cc;
}

.lb-rating-stat {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  min-width: auto;
}

.rating-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 120px;
  padding: 3px 8px;
  border: 1px solid;
  border-radius: 999px;
  opacity: 0.82;
}

.rating-pill.primary {
  opacity: 1;
}

.rating-pill strong {
  font-size: 14px;
}

.rating-pill small {
  font-size: 11px;
  font-weight: 700;
}

.lb-reg {
  display: none;
}

.rating-cache-tag {
  padding: 0 5px;
  line-height: 18px;
}

.lb-reg {
  width: 132px;
  text-align: right;
  color: #909399;
  font-size: 12px;
}

.pager {
  display: flex;
  justify-content: center;
  margin-top: 14px;
}

@media (max-width: 768px) {
  .leaderboard-page {
    width: 100%;
  }

  .lb-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .lb-tools {
    justify-content: flex-start;
  }

  .lb-row {
    flex-wrap: wrap;
    border: 1px solid #ebeef5;
    margin-bottom: 8px;
  }

  .lb-row + .lb-row {
    border-top: 1px solid #ebeef5;
  }

  .lb-stats {
    width: 100%;
    justify-content: flex-start;
    gap: 16px;
    padding-left: 52px;
    box-sizing: border-box;
  }

  .lb-stat {
    flex-direction: row;
    gap: 5px;
    min-width: auto;
  }
}
</style>
