<template>
  <div class="home-page">
    <el-row class="home-layout">
      <el-col :xs="24" :sm="24" :md="16">
        <template v-for="block in mainBlocks" :key="block.id">
          <el-card v-if="block.type === 'announcements'" class="box-card" shadow="hover">
            <template #header>
              <div class="card-header">
                {{ block.title }}
                <el-popconfirm v-if="$can('announcement.manage')" confirm-button-text="确认" cancel-button-text="取消" title="确认添加公告?"
                  @confirm="addAnnouncement">
                  <template #reference>
                    <el-button type="danger">
                      <el-icon class="el-icon--left"><Plus /></el-icon>
                      添加公告
                    </el-button>
                  </template>
                </el-popconfirm>
              </div>
            </template>
            <el-table :data="announcements" v-loading="announcementLoading">
              <el-table-column prop="title" label="标题" min-width="60%">
                <template #default="scope">
                  <router-link :to="'/announcement/' + scope.row.aid" class="rlink">
                    {{ scope.row.title }}
                  </router-link>
                </template>
              </el-table-column>
              <el-table-column prop="time" label="发布时间" min-width="40%" />
            </el-table>
          </el-card>
          <el-card v-else-if="block.type === 'hitokoto'" class="box-card" shadow="hover">
            <template #header>
              <div class="card-header">
                {{ block.title }}
                <el-button type="primary" @click="updateHitokoto" color="#626aef" plain>
                  <el-icon class="el-icon--left"><Refresh /></el-icon>
                  再来一个
                </el-button>
              </div>
            </template>
            <div class="hitokoto-text">{{ motto.hitokoto }}</div>
            <div class="hitokoto-from">from {{ motto.from }}</div>
          </el-card>
          <el-card v-else-if="block.type === 'markdown'" class="box-card markdown-card" shadow="hover">
            <template #header>
              <div class="card-header">{{ block.title }}</div>
            </template>
            <v-md-preview :text="block.content || ''" />
          </el-card>
          <el-card v-else-if="block.type === 'notice' && homepageNotice" class="box-card markdown-card home-notice-card" shadow="hover">
            <template #header>
              <div class="card-header">{{ block.title }}</div>
            </template>
            <v-md-preview :text="homepageNotice" />
          </el-card>
          <el-card v-else-if="block.type === 'countdown' && countdownItems.length" class="box-card" shadow="hover">
            <template #header>
              <div class="card-header">{{ block.title }}</div>
            </template>
            <div class="countdown-list">
              <div v-for="item in countdownItems" :key="item.name" class="countdown-item">
                <span class="countdown-event">{{ item.name }}</span>
                <span class="countdown-time" :class="{ finished: item.finished }">{{ item.remainingText }}</span>
              </div>
            </div>
          </el-card>
          <el-card v-else-if="block.type === 'problemSearch'" class="box-card" shadow="hover">
            <template #header>
              <div class="card-header">{{ block.title }}</div>
            </template>
            <div class="problem-search-row">
              <el-autocomplete
                v-model="problemSearchKeyword"
                class="problem-search-input"
                value-key="value"
                :fetch-suggestions="searchProblemSuggestions"
                clearable
                placeholder="输入题号或标题"
                @select="openProblemSuggestion"
                @keyup.enter="handleProblemSearchEnter"
              >
                <template #default="{ item }">
                  <div class="problem-suggestion-title">{{ item.value }}</div>
                  <div class="problem-suggestion-meta">{{ problemTypeText(item) }}</div>
                </template>
              </el-autocomplete>
              <el-button type="primary" @click="openProblemSearch">
                <el-icon><Search /></el-icon>
              </el-button>
            </div>
          </el-card>
          <el-card v-else-if="block.type === 'friendLinks' && friendLinkItems.length" class="box-card" shadow="hover">
            <template #header>
              <div class="card-header">{{ block.title }}</div>
            </template>
            <div class="friend-link-list">
              <el-link v-for="item in friendLinkItems" :key="item.name" :href="item.url" target="_blank" rel="noopener noreferrer">
                {{ item.name }}
              </el-link>
            </div>
          </el-card>
          <el-card v-else-if="block.type === 'topUsers'" class="box-card" shadow="hover">
            <template #header>
              <div class="card-header">{{ block.title }}</div>
            </template>
            <el-table :data="topUsers" v-loading="homepageLoading" empty-text="暂无用户">
              <el-table-column label="#" width="54">
                <template #default="scope">{{ scope.$index + 1 }}</template>
              </el-table-column>
              <el-table-column label="用户" min-width="170" align="left">
                <template #default="scope">
                  <div class="top-user-cell">
                    <el-avatar :size="30" shape="square" :src="homeUserAvatar(scope.row)" />
                    <div class="top-user-copy">
                      <router-link class="rlink" :to="userProfilePath(scope.row.username)">
                        {{ scope.row.nickname || scope.row.username }}
                      </router-link>
                      <div class="top-user-sub">@{{ scope.row.username }}</div>
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column :label="topUserMetricLabel" width="90">
                <template #default="scope">{{ topUserMetric(scope.row) }}</template>
              </el-table-column>
            </el-table>
          </el-card>
          <el-card v-else-if="block.type === 'latestProblems'" class="box-card" shadow="hover">
            <template #header>
              <div class="card-header">{{ block.title }}</div>
            </template>
            <el-table :data="latestProblems" v-loading="homepageLoading" empty-text="暂无题目">
              <el-table-column label="题目" min-width="220" align="left">
                <template #default="scope">
                  <router-link class="rlink problem-title" :to="problemLink(scope.row)">
                    {{ scope.row.title }}
                  </router-link>
                  <div class="problem-sub">
                    {{ problemTypeText(scope.row) }}
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="通过/提交" width="110">
                <template #default="scope">
                  {{ acceptedCount(scope.row) }}/{{ submissionCount(scope.row) }}
                </template>
              </el-table-column>
            </el-table>
          </el-card>
          <cuteRank v-else-if="block.type === 'rabbitRank'" />
          <rabbitData v-else-if="block.type === 'rabbitData'" />
        </template>
      </el-col>

      <el-col :xs="24" :sm="24" :md="8">
        <template v-for="block in sideBlocks" :key="block.id">
          <el-card v-if="block.type === 'announcements'" class="box-card" shadow="hover">
            <template #header>
              <div class="card-header">{{ block.title }}</div>
            </template>
            <el-table :data="announcements" v-loading="announcementLoading">
              <el-table-column prop="title" label="标题">
                <template #default="scope">
                  <router-link :to="'/announcement/' + scope.row.aid" class="rlink">
                    {{ scope.row.title }}
                  </router-link>
                </template>
              </el-table-column>
            </el-table>
          </el-card>
          <el-card v-else-if="block.type === 'hitokoto'" class="box-card" shadow="hover">
            <template #header>
              <div class="card-header">
                {{ block.title }}
                <el-button type="primary" @click="updateHitokoto" color="#626aef" plain>
                  <el-icon class="el-icon--left"><Refresh /></el-icon>
                  再来一个
                </el-button>
              </div>
            </template>
            <div class="hitokoto-text">{{ motto.hitokoto }}</div>
            <div class="hitokoto-from">from {{ motto.from }}</div>
          </el-card>
          <el-card v-else-if="block.type === 'markdown'" class="box-card markdown-card" shadow="hover">
            <template #header>
              <div class="card-header">{{ block.title }}</div>
            </template>
            <v-md-preview :text="block.content || ''" />
          </el-card>
          <el-card v-else-if="block.type === 'notice' && homepageNotice" class="box-card markdown-card home-notice-card" shadow="hover">
            <template #header>
              <div class="card-header">{{ block.title }}</div>
            </template>
            <v-md-preview :text="homepageNotice" />
          </el-card>
          <el-card v-else-if="block.type === 'countdown' && countdownItems.length" class="box-card" shadow="hover">
            <template #header>
              <div class="card-header">{{ block.title }}</div>
            </template>
            <div class="countdown-list">
              <div v-for="item in countdownItems" :key="item.name" class="countdown-item">
                <span class="countdown-event">{{ item.name }}</span>
                <span class="countdown-time" :class="{ finished: item.finished }">{{ item.remainingText }}</span>
              </div>
            </div>
          </el-card>
          <el-card v-else-if="block.type === 'problemSearch'" class="box-card" shadow="hover">
            <template #header>
              <div class="card-header">{{ block.title }}</div>
            </template>
            <div class="problem-search-row">
              <el-autocomplete
                v-model="problemSearchKeyword"
                class="problem-search-input"
                value-key="value"
                :fetch-suggestions="searchProblemSuggestions"
                clearable
                placeholder="输入题号或标题"
                @select="openProblemSuggestion"
                @keyup.enter="handleProblemSearchEnter"
              >
                <template #default="{ item }">
                  <div class="problem-suggestion-title">{{ item.value }}</div>
                  <div class="problem-suggestion-meta">{{ problemTypeText(item) }}</div>
                </template>
              </el-autocomplete>
              <el-button type="primary" @click="openProblemSearch">
                <el-icon><Search /></el-icon>
              </el-button>
            </div>
          </el-card>
          <el-card v-else-if="block.type === 'friendLinks' && friendLinkItems.length" class="box-card" shadow="hover">
            <template #header>
              <div class="card-header">{{ block.title }}</div>
            </template>
            <div class="friend-link-list">
              <el-link v-for="item in friendLinkItems" :key="item.name" :href="item.url" target="_blank" rel="noopener noreferrer">
                {{ item.name }}
              </el-link>
            </div>
          </el-card>
          <el-card v-else-if="block.type === 'topUsers'" class="box-card" shadow="hover">
            <template #header>
              <div class="card-header">{{ block.title }}</div>
            </template>
            <el-table :data="topUsers" v-loading="homepageLoading" empty-text="暂无用户">
              <el-table-column label="#" width="54">
                <template #default="scope">{{ scope.$index + 1 }}</template>
              </el-table-column>
              <el-table-column label="用户" min-width="140" align="left">
                <template #default="scope">
                  <div class="top-user-cell">
                    <el-avatar :size="30" shape="square" :src="homeUserAvatar(scope.row)" />
                    <div class="top-user-copy">
                      <router-link class="rlink" :to="userProfilePath(scope.row.username)">
                        {{ scope.row.nickname || scope.row.username }}
                      </router-link>
                      <div class="top-user-sub">@{{ scope.row.username }}</div>
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column :label="topUserMetricLabel" width="86">
                <template #default="scope">{{ topUserMetric(scope.row) }}</template>
              </el-table-column>
            </el-table>
          </el-card>
          <el-card v-else-if="block.type === 'latestProblems'" class="box-card" shadow="hover">
            <template #header>
              <div class="card-header">{{ block.title }}</div>
            </template>
            <el-table :data="latestProblems" v-loading="homepageLoading" empty-text="暂无题目">
              <el-table-column label="题目" min-width="150" align="left">
                <template #default="scope">
                  <router-link class="rlink problem-title" :to="problemLink(scope.row)">
                    {{ scope.row.title }}
                  </router-link>
                  <div class="problem-sub">
                    {{ problemTypeText(scope.row) }}
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="通过/提交" width="100">
                <template #default="scope">
                  {{ acceptedCount(scope.row) }}/{{ submissionCount(scope.row) }}
                </template>
              </el-table-column>
            </el-table>
          </el-card>
          <cuteRank v-else-if="block.type === 'rabbitRank'" />
          <rabbitData v-else-if="block.type === 'rabbitData'" />
        </template>
      </el-col>
    </el-row>
  </div>
</template>

<script>
import axios from "axios";
import { userProfilePath } from '@/assets/common'
import cuteRank from '@/components/rabbit/cuteRankList.vue'
import rabbitData from '@/components/rabbit/rabbitClickData.vue'

export default {
  name: "myHeader",
  components: {
    rabbitData,
    cuteRank,
  },
  data() {
    return {
      motto: {},
      announcements: [],
      announcementLoading: false,
      homepageLoading: false,
      topUsers: [],
      latestProblems: [],
      homepageNotice: '',
      homepageCountdown: null,
      homepageFriendLinks: null,
      problemSearchKeyword: '',
      problemSearchSelecting: false,
      now: Date.now(),
      countdownTimer: null,
      homeConfig: { blocks: [] },
    }
  },
  computed: {
    enabledBlocks() {
      return (this.homeConfig.blocks || []).filter(block => block.enabled);
    },
    mainBlocks() {
      return this.enabledBlocks.filter(block => block.column !== 'side');
    },
    sideBlocks() {
      return this.enabledBlocks.filter(block => block.column === 'side');
    },
    sortUserByRating() {
      const pref = this.$store.state.serverPreference || {};
      return !!(pref.misc && pref.misc.sortUserByRating);
    },
    topUserMetricLabel() {
      return this.sortUserByRating ? '积分' : 'AC';
    },
    countdownItems() {
      const items = (this.homepageCountdown && this.homepageCountdown.items) || {};
      return Object.entries(items).map(([name, time]) => {
        const target = new Date(time).getTime();
        const diff = target - this.now;
        return {
          name,
          time,
          target,
          finished: Number.isFinite(target) && diff <= 0,
          remainingText: this.formatCountdown(diff, target),
        };
      }).filter(item => Number.isFinite(item.target));
    },
    friendLinkItems() {
      const links = (this.homepageFriendLinks && this.homepageFriendLinks.links) || {};
      return Object.entries(links)
        .map(([name, url]) => ({ name, url }))
        .filter(item => item.name && item.url);
    },
  },
  methods: {
    userProfilePath,
    loadHomeConfig() {
      return axios.post('/api/common/getHomeConfig').then(res => {
        if (res.status === 200) this.homeConfig = res.data.data || { blocks: [] };
        else this.$message.error(res.data.message || '获取首页设置失败');
      }).catch(err => {
        this.$message.error('获取首页设置失败' + err.message);
      });
    },
    loadHomepageData() {
      this.homepageLoading = true;
      return axios.get('/api/homepage/getHomepage').then(res => {
        if (res.status === 200) {
          this.topUsers = res.data.topUsers || [];
          this.latestProblems = res.data.latestUpdatedProblems || [];
          this.homepageNotice = res.data.notice || '';
          this.homepageCountdown = res.data.countdown || null;
          this.homepageFriendLinks = res.data.friendLinks || null;
        }
        else this.$message.error(res.data.message || '获取首页数据失败');
      }).catch(err => {
        this.$message.error('获取首页数据失败' + err.message);
      }).finally(() => {
        this.homepageLoading = false;
      });
    },
    topUserMetric(user) {
      return this.sortUserByRating ? Number(user.rating || 0) : Number(user.acceptedProblemCount || 0);
    },
    homeUserAvatar(user) {
      const avatar = user && user.avatar;
      if (!avatar) return '/default-avatar.svg';
      if (typeof avatar === 'string') return avatar;
      const type = avatar.type || '';
      const key = avatar.key || '';
      if (type === 'qq' && key) return `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(key)}&s=3`;
      if (type === 'github' && key) return `https://github.com/${encodeURIComponent(key)}.png?size=80`;
      if (type === 'gravatar' && key) return `https://www.gravatar.com/avatar/${encodeURIComponent(key)}?s=80&d=identicon`;
      return '/default-avatar.svg';
    },
    problemMeta(problem) {
      return (problem && problem.meta) || {};
    },
    problemLink(problem) {
      const meta = this.problemMeta(problem);
      return '/problem/' + (meta.pid || meta.id || '');
    },
    problemTypeText(problem) {
      return this.problemMeta(problem).type || 'Traditional';
    },
    submissionCount(problem) {
      return Number(this.problemMeta(problem).submissionCount || 0);
    },
    acceptedCount(problem) {
      return Number(this.problemMeta(problem).acceptedSubmissionCount || 0);
    },
    formatCountdown(diff, target) {
      if (!Number.isFinite(target)) return '时间未设置';
      if (diff <= 0) return '已到时间';
      const seconds = Math.floor(diff / 1000);
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const restSeconds = seconds % 60;
      const pad = value => String(value).padStart(2, '0');
      if (days > 0) return `${days} 天 ${hours} 时`;
      if (hours > 0) return `${hours}:${pad(minutes)}:${pad(restSeconds)}`;
      return `${pad(minutes)}:${pad(restSeconds)}`;
    },
    problemDisplayName(problem) {
      const meta = this.problemMeta(problem);
      const id = meta.pid || meta.id;
      return `${id ? `${id}. ` : ''}${problem.title || 'Untitled'}`;
    },
    searchProblemSuggestions(query, callback) {
      const keyword = String(query || '').trim();
      if (!keyword) {
        callback([]);
        return;
      }
      axios.post('/api/problem/queryProblemSet', {
        locale: 'zh-CN',
        keyword,
        keywordMatchesId: true,
        titleOnly: true,
        skipCount: 0,
        takeCount: 7,
      }).then(res => {
        const data = res.data || {};
        if (data.error) {
          callback([]);
          return;
        }
        callback((data.result || []).map(item => ({
          ...item,
          value: this.problemDisplayName(item),
        })));
      }).catch(() => {
        callback([]);
      });
    },
    openProblemSuggestion(problem) {
      this.problemSearchSelecting = true;
      this.$router.push(this.problemLink(problem));
      setTimeout(() => {
        this.problemSearchSelecting = false;
      }, 0);
    },
    handleProblemSearchEnter() {
      if (this.problemSearchSelecting) return;
      this.openProblemSearch();
    },
    openProblemSearch() {
      const keyword = this.problemSearchKeyword.trim();
      this.$router.push({
        path: '/p',
        query: keyword ? { name: keyword } : {},
      });
    },
    updateHitokoto() {
      axios.post('/api/common/getHitokoto').then(res => {
        if (res.status === 200)
          this.motto = res.data
        else {
          this.motto.hitokoto = "加载一言时发生错误。";
          this.motto.from = "/";
        }
      }).catch(() => {
        this.motto.hitokoto = "加载一言时发生错误。";
        this.motto.from = "/";
      });
    },
    getAnnouncements() {
      this.announcementLoading = true;
      axios.post('/api/common/getAnnouncementList').then(res => {
        this.announcements = res.data.data;
      }).finally(() => {
        this.announcementLoading = false;
      });
    },
    addAnnouncement() {
      axios.post('/api/admin/addAnnouncement').then(res => {
        if (res.status === 200)
          this.$router.push('/announcement/edit/' + res.data.aid);
        else
          this.$message.error('添加公告失败' + res.data.message);
      });
    },
  },
  mounted() {
    this.loadHomeConfig();
    this.updateHitokoto();
    this.getAnnouncements();
    this.loadHomepageData();
    this.countdownTimer = setInterval(() => {
      this.now = Date.now();
    }, 1000);
  },
  beforeUnmount() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
  },
}
</script>

<style scoped>
.home-page {
  margin: 0 auto;
  max-width: 1500px;
}

.home-layout {
  margin: auto;
}

.box-card {
  margin: 10px;
  text-align: center;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
  font-weight: bolder;
}

.hitokoto-text {
  font-size: 14px;
}

.hitokoto-from {
  float: right;
  margin: 10px;
  font-size: 12px;
  color: grey;
}

.markdown-card {
  text-align: left;
}

.top-user-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.top-user-copy {
  min-width: 0;
  line-height: 1.2;
}

.top-user-copy .rlink {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.top-user-sub {
  overflow: hidden;
  color: #909399;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.problem-title {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.problem-sub {
  color: #909399;
  font-size: 12px;
}

.home-notice-card {
  border-top: 3px solid #f56c6c;
}

.countdown-list {
  display: grid;
  gap: 10px;
  text-align: left;
}

.countdown-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-height: 28px;
}

.countdown-event {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.countdown-time {
  color: #409eff;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-weight: 700;
  white-space: nowrap;
}

.countdown-time.finished {
  color: #909399;
}

.problem-search-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px;
  gap: 8px;
  align-items: center;
}

.problem-search-input {
  width: 100%;
}

.problem-suggestion-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.problem-suggestion-meta {
  color: #909399;
  font-size: 12px;
  line-height: 1.3;
}

.friend-link-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  justify-content: flex-start;
  text-align: left;
}

@media (max-width: 768px) {
  .card-header {
    height: auto;
    min-height: 28px;
    gap: 8px;
    flex-wrap: wrap;
  }

  .countdown-item {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}
</style>
