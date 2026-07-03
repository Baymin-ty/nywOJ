<template>
  <div class="profile-page">
    <!-- ── Hero ───────────────────────────────────────────── -->
    <div class="profile-hero">
      <div class="hero-banner"></div>
      <div class="hero-inner">
        <el-avatar class="hero-avatar" shape="circle" :size="120" :src="avatarAddress" />
        <div class="hero-main">
          <div class="hero-name-row">
            <span id="name">{{ info.nickname || info.name }}</span>
            <span v-if="info.nickname" class="username">@{{ info.name }}</span>
            <el-tag v-for="r in roleLabels" :key="r" size="small" effect="light" round class="role-tag">{{ r }}</el-tag>
          </div>
          <div v-if="info.bio" class="bio">{{ info.bio }}</div>
          <div class="hero-meta">
            <span v-if="info.location" class="meta-item">
              <el-icon><Place /></el-icon>{{ info.location }}
            </span>
            <span v-if="info.organization" class="meta-item">
              <el-icon><School /></el-icon>{{ info.organization }}
            </span>
            <a v-if="info.homepageUrl" class="meta-item meta-link" :href="info.homepageUrl" target="_blank"
              rel="noreferrer noopener">
              <el-icon><Link /></el-icon>{{ homepageHost }}
            </a>
            <a v-if="info.qq" class="meta-item meta-link" :href="'https://wpa.qq.com/msgrd?V=3&Uin=' + info.qq"
              target="_blank" rel="noreferrer noopener">QQ</a>
            <a v-if="info.telegram" class="meta-item meta-link" :href="'https://t.me/' + info.telegram" target="_blank"
              rel="noreferrer noopener">Telegram</a>
            <a v-if="info.github" class="meta-item meta-link" :href="'https://github.com/' + info.github"
              target="_blank" rel="noreferrer noopener">GitHub</a>
          </div>
        </div>
        <div class="hero-actions">
          <el-button v-if="$store.state.uid === Number(info.uid)" type="primary" plain :icon="Edit"
            @click="$router.push('/user/edit')">修改资料</el-button>
        </div>
      </div>
      <div class="hero-stats">
        <div class="stat-tile">
          <div class="tile-value" :style="{ color: ratingTier(info.rating).color }">{{ info.rating || 0 }}</div>
          <div class="tile-label">
            积分
            <span class="tier-badge" :style="{
              color: ratingTier(info.rating).color,
              backgroundColor: ratingTier(info.rating).bg,
              borderColor: ratingTier(info.rating).color,
            }">{{ ratingTier(info.rating).label }}</span>
          </div>
        </div>
        <router-link class="stat-tile" to="/users">
          <div class="tile-value">#{{ info.rank || '-' }}</div>
          <div class="tile-label">排名</div>
        </router-link>
        <div class="stat-tile">
          <div class="tile-value accepted">{{ info.acceptedProblemCount || 0 }}</div>
          <div class="tile-label">AC 题数</div>
        </div>
        <div class="stat-tile">
          <div class="tile-value">{{ info.contestTakePartCount || 0 }}</div>
          <div class="tile-label">参加比赛</div>
        </div>
      </div>
    </div>

    <!-- ── Tabs ───────────────────────────────────────────── -->
    <el-tabs v-model="activeTab" class="profile-tabs" @tab-change="onTabChange">
      <!-- 资料 -->
      <el-tab-pane label="资料" name="about">
        <el-card id="main" class="motto-card" shadow="never">
          <template #header>
            <div class="card-title">个人主页</div>
          </template>
          <v-md-preview :text="info.motto" />
        </el-card>
        <el-card class="about-card" shadow="never">
          <template #header>
            <div class="card-title">基本资料</div>
          </template>
          <div class="about-grid">
            <div v-if="info.email" class="about-item">
              <span class="about-label">邮箱</span>
              <span class="about-value">{{ info.email }}</span>
            </div>
            <div class="about-item">
              <span class="about-label">注册时间</span>
              <span class="about-value">{{ info.reg_time }}</span>
            </div>
            <div v-if="info.login_time" class="about-item">
              <span class="about-label">最近登录</span>
              <span class="about-value">{{ info.login_time }}</span>
            </div>
            <div class="about-item">
              <span class="about-label">兔兔点击数</span>
              <span class="about-value">{{ info.clickCnt }}</span>
            </div>
          </div>
        </el-card>
        <div class="stat-panel">
          <div id="clickCnt" class="chart-box click-box"></div>
        </div>
      </el-tab-pane>

      <!-- 提交 -->
      <el-tab-pane label="提交" name="submit">
        <div class="stat-strip">
          <div class="mini-stat">
            <div class="mini-value">{{ submissionStats.total || 0 }}</div>
            <div class="mini-label">提交数</div>
          </div>
          <div class="mini-stat">
            <div class="mini-value accepted">{{ submissionStats.accepted || 0 }}</div>
            <div class="mini-label">AC 提交</div>
          </div>
          <div class="mini-stat">
            <div class="mini-value">{{ passRate }}%</div>
            <div class="mini-label">提交通过率</div>
          </div>
        </div>
        <div class="stat-panel heat-panel">
          <div id="submissionHeat" class="chart-box heat-box"></div>
        </div>
        <div class="stat-panel">
          <div id="resultStat" class="chart-box tall-box"></div>
        </div>
      </el-tab-pane>

      <!-- 解题 -->
      <el-tab-pane label="解题" name="solve">
        <div class="stat-strip">
          <div class="mini-stat">
            <div class="mini-value accepted">{{ info.acceptedProblemCount || 0 }}</div>
            <div class="mini-label">通过题目数</div>
          </div>
          <div class="mini-stat">
            <div class="mini-value">{{ (submissionStats.tags || []).length }}</div>
            <div class="mini-label">涉及标签</div>
          </div>
          <div class="mini-stat">
            <div class="mini-value">{{ topLevelLabel }}</div>
            <div class="mini-label">最高通过难度</div>
          </div>
        </div>
        <div class="panel-grid">
          <div class="stat-panel">
            <div id="levelStat" class="chart-box tall-box"></div>
          </div>
          <div class="stat-panel">
            <div id="tagStat" class="chart-box tall-box"></div>
          </div>
        </div>
      </el-tab-pane>

      <!-- Rating -->
      <el-tab-pane v-if="ratingHistory.length" label="Rating" name="rating">
        <div class="stat-strip">
          <div class="mini-stat">
            <div class="mini-value" :style="{ color: ratingTier(info.rating).color }">{{ info.rating || 0 }}</div>
            <div class="mini-label">
              积分
              <span class="tier-badge" :style="{
                color: ratingTier(info.rating).color,
                backgroundColor: ratingTier(info.rating).bg,
                borderColor: ratingTier(info.rating).color,
              }">{{ ratingTier(info.rating).label }}</span>
            </div>
          </div>
          <router-link class="mini-stat" :to="{ path: '/users', query: { sortBy: 'rating' } }">
            <div class="mini-value rank">#{{ info.ratingRank || '-' }}</div>
            <div class="mini-label">Rating 排名</div>
          </router-link>
          <div class="mini-stat">
            <div class="mini-value">{{ info.contestTakePartCount || 0 }}</div>
            <div class="mini-label">参加比赛</div>
          </div>
        </div>
        <el-alert v-if="ratingMeta.ratingCacheMismatch" class="rating-cache-alert" type="warning" show-icon
          :closable="false" :title="ratingCacheMismatchText" />
        <el-card class="rating-history-card" shadow="never">
          <template #header>
            <div class="card-title">{{ ratingHistoryTitle }}</div>
          </template>
          <div id="ratingTrend" class="rating-trend"></div>
          <el-table :data="ratingHistory" size="small" :header-cell-style="{ textAlign: 'center' }"
            :cell-style="{ textAlign: 'center' }" v-loading="ratingHistoryLoading">
            <el-table-column label="比赛" min-width="180">
              <template #default="scope">
                <router-link class="contest-link" :to="'/contest/' + scope.row.cid">{{ scope.row.title }}</router-link>
                <div class="rating-date">{{ scope.row.start }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="rank" label="排名" width="80" />
            <el-table-column label="变化" width="120">
              <template #default="scope">
                <span :class="ratingDeltaClass(scope.row.delta)">{{ signedDelta(scope.row.delta) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="Rating" width="140">
              <template #default="scope">
                {{ scope.row.oldRating }} → {{ scope.row.newRating }}
              </template>
            </el-table-column>
          </el-table>
          <div class="rating-history-actions" v-if="ratingMeta.historyHasMore">
            <el-button size="small" plain :loading="ratingHistoryLoading" @click="loadMoreRatingHistory">
              加载更多
            </el-button>
          </div>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script>
import axios from "axios";
import { Edit, Link, School } from '@element-plus/icons-vue';
import chart from '@/chart/myChart';
import { getRatingTier, resColor } from '@/assets/common';

export default {
  name: "userInfo",
  components: { Link, School },
  data() {
    return {
      uid: 0,
      username: '',
      info: {},
      avatarAddress: '',
      activeTab: 'about',
      Edit,
      roleLabel: {
        user: '普通用户',
        problem_setter: '出题人',
        contest_manager: '比赛管理员',
        judge_admin: '判题管理员',
        moderator: '管理员',
        super_admin: '超级管理员',
      },
      submissionStats: { heatmap: [], results: [], levels: [], tags: [], total: 0, accepted: 0 },
      ratingHistory: [],
      ratingMeta: {},
      ratingHistoryLoading: false,
      date: [],
      clickCnt: [],
      charts: {},
      levels: [
        { label: '暂未评级', color: '#BFBFBF' },
        { label: '入门', color: '#FE4C61' },
        { label: '普及', color: '#FFC116' },
        { label: '提高', color: '#52C41A' },
        { label: '省选', color: '#3498DB' },
        { label: 'NOI / NOI+', color: '#0E1D69' },
      ],
    }
  },
  computed: {
    roleLabels() {
      const roles = (this.info && this.info.roles) || [];
      return roles
        .filter((k) => k !== 'user')
        .map((k) => this.roleLabel[k] || k);
    },
    homepageHost() {
      const url = this.info && this.info.homepageUrl;
      if (!url) return '';
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch (_) {
        return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      }
    },
    passRate() {
      const total = Number(this.submissionStats.total || 0);
      const accepted = Number(this.submissionStats.accepted || 0);
      return total ? Math.round(accepted * 100 / total) : 0;
    },
    topLevelLabel() {
      const raw = this.submissionStats.levels || [];
      let top = -1;
      raw.forEach((i) => {
        if (Number(i.solved || 0) > 0) top = Math.max(top, Number(i.level));
      });
      return top >= 0 && this.levels[top] ? this.levels[top].label : '—';
    },
    ratingCacheMismatchText() {
      return `当前缓存 Rating 为 ${this.ratingMeta.rating || 0}，有效历史为 ${this.ratingMeta.historyRating || 0}`;
    },
    ratingHistoryTitle() {
      const total = Number(this.ratingMeta.historyCount || 0);
      const returned = Number(this.ratingMeta.historyReturnedCount || this.ratingHistory.length || 0);
      if (!total || total <= returned) return 'Rating 变化';
      return `Rating 变化（最近 ${returned} / 共 ${total} 场）`;
    },
  },
  watch: {
    '$route.params': {
      handler() {
        this.loadRouteUser();
      },
      deep: true,
    },
  },
  methods: {
    // Charts are rendered lazily, only for the visible tab, so each one inits
    // at its real size (hidden tab panes are 0×0 and make echarts crash).
    renderTabCharts(tab) {
      this.$nextTick(() => {
        if (tab === 'about') this.renderClickChart();
        else if (tab === 'submit') { this.renderSubmissionHeat(); this.renderResultStat(); }
        else if (tab === 'solve') { this.renderLevelStat(); this.renderTagStat(); }
        else if (tab === 'rating') this.renderRatingTrend();
      });
    },
    onTabChange(name) {
      this.renderTabCharts(name);
    },
    loadRouteUser() {
      this.uid = Number(this.$route.params.uid) || 0;
      this.username = this.$route.params.username || '';
      this.all().then((loaded) => {
        if (loaded) this.getUserClickData();
      });
    },
    all() {
      const payload = this.username ? { username: this.username } : { uid: this.uid };
      return axios.post('/api/user/getUserPublicInfo', payload).then((res) => {
        if (res.data.info) {
          this.info = res.data.info;
          this.uid = Number(this.info.uid);
          if (!this.info.motto) this.info.motto = "Ta暂时没有编辑个人主页噢";
          this.submissionStats = this.info.submissionStats || { heatmap: [], results: [], levels: [], tags: [], total: 0, accepted: 0 };
          this.avatarAddress = this.info.avatar || this.getAvatarAddress(this.info.qq);
          this.renderTabCharts(this.activeTab);
          this.loadRatingHistory();
          return true;
        } else {
          this.$message.error('获取用户信息失败');
          return false;
        }
      }).catch(err => {
        this.$message.error('获取用户信息失败' + err.message);
        return false;
      });
    },
    loadRatingHistory(append = false) {
      if (!this.uid) {
        this.ratingHistory = [];
        this.ratingMeta = {};
        this.ratingHistoryLoading = false;
        this.disposeChart('rating');
        return;
      }
      const offset = append ? this.ratingHistory.length : 0;
      if (!append) this.disposeChart('rating');
      this.ratingHistoryLoading = true;
      axios.post('/api/contest/getUserRatingHistory', {
        uid: this.uid,
        limit: 20,
        offset,
      }).then((res) => {
        const rows = res.data.data || [];
        this.disposeChart('rating');
        this.ratingHistory = append ? this.ratingHistory.concat(rows) : rows;
        this.ratingMeta = res.data.user || {};
        if (this.activeTab === 'rating') this.$nextTick(() => this.renderRatingTrend());
      }).catch(() => {
        if (!append) {
          this.ratingHistory = [];
          this.ratingMeta = {};
          this.disposeChart('rating');
        }
      }).finally(() => {
        this.ratingHistoryLoading = false;
      });
    },
    loadMoreRatingHistory() {
      if (this.ratingHistoryLoading || !this.ratingMeta.historyHasMore) return;
      this.loadRatingHistory(true);
    },
    signedDelta(delta) {
      const value = Number(delta || 0);
      return value > 0 ? `+${value}` : String(value);
    },
    ratingDeltaClass(delta) {
      const value = Number(delta || 0);
      if (value > 0) return 'rating-delta positive';
      if (value < 0) return 'rating-delta negative';
      return 'rating-delta';
    },
    ratingTier(rating) {
      return getRatingTier(rating);
    },
    getAvatarAddress(qq) {
      if (!qq || !qq.length) return '/default-avatar.svg';
      return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=5`;
    },
    dateText(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    },
    heatRange() {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 364);
      return [this.dateText(start), this.dateText(end)];
    },
    renderSubmissionHeat() {
      const el = document.getElementById("submissionHeat");
      if (!el) return;
      const rawData = this.submissionStats.heatmap || [];
      if (!rawData.length) { this.disposeChart('heat'); return; }
      const data = rawData.map((i) => [i.date, i.cnt]);
      const max = Math.max(1, ...data.map((i) => i[1]));
      this.disposeChart('heat');
      this.charts.heat = chart.init(el);
      this.charts.heat.setOption({
        title: { text: '最近 1 年提交热度', left: 'center', top: 6, textStyle: { fontSize: 13 } },
        tooltip: {
          formatter: (p) => `${p.value[0]}<br/>提交 ${p.value[1]} 次`,
        },
        visualMap: {
          min: 0,
          max,
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
          itemWidth: 12,
          itemHeight: 110,
          inRange: { color: ['#eef6ff', '#409EFF'] },
        },
        calendar: {
          top: 42,
          left: 36,
          right: 18,
          bottom: 36,
          range: this.heatRange(),
          cellSize: ['auto', 14],
          splitLine: { lineStyle: { color: '#ebeef5' } },
          itemStyle: { borderWidth: 2, borderColor: '#fff', color: '#f5f7fa' },
          yearLabel: { show: false },
          monthLabel: { fontSize: 10, color: '#909399' },
          dayLabel: { firstDay: 1, fontSize: 10, color: '#909399', nameMap: ['日', '一', '二', '三', '四', '五', '六'] },
        },
        series: [{ type: 'heatmap', coordinateSystem: 'calendar', data }],
      });
    },
    renderResultStat() {
      const el = document.getElementById("resultStat");
      if (!el) return;
      const rawResults = this.submissionStats.results || [];
      if (!rawResults.length) { this.disposeChart('result'); return; }
      const data = rawResults.map((i) => ({
        name: i.result,
        value: i.cnt,
        itemStyle: { color: resColor[i.result] || '#909399' },
      }));
      this.disposeChart('result');
      this.charts.result = chart.init(el);
      this.charts.result.setOption({
        title: { text: '提交结果统计', left: 'center', top: 10, textStyle: { fontSize: 14 } },
        tooltip: { trigger: 'item', formatter: '{b}<br/>{c} 次 ({d}%)' },
        legend: { type: 'scroll', bottom: 4, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
        series: [{
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['50%', '50%'],
          label: { show: false },
          data,
        }],
      });
    },
    renderLevelStat() {
      const el = document.getElementById("levelStat");
      if (!el) return;
      const raw = this.submissionStats.levels || [];
      const byLevel = new Map(raw.map((i) => [Number(i.level), Number(i.solved || 0)]));
      const data = this.levels.map((l, idx) => ({
        name: l.label,
        value: byLevel.get(idx) || 0,
        itemStyle: { color: l.color },
      }));
      if (!data.some((i) => i.value > 0)) { this.disposeChart('level'); return; }
      this.disposeChart('level');
      this.charts.level = chart.init(el);
      this.charts.level.setOption({
        title: { text: 'AC 难度分布', left: 'center', top: 10, textStyle: { fontSize: 14 } },
        tooltip: { trigger: 'item', formatter: '{b}<br/>AC {c} 题' },
        legend: { type: 'scroll', bottom: 4, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
        series: [{
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['50%', '50%'],
          label: { show: false },
          data,
        }],
      });
    },
    renderTagStat() {
      const el = document.getElementById("tagStat");
      if (!el) return;
      const raw = (this.submissionStats.tags || []).slice(0, 8).reverse();
      if (!raw.length) { this.disposeChart('tag'); return; }
      this.disposeChart('tag');
      this.charts.tag = chart.init(el);
      this.charts.tag.setOption({
        title: { text: '常练标签通过率', left: 'center', top: 10, textStyle: { fontSize: 14 } },
        grid: { left: 80, top: 48, right: 30, bottom: 24 },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          formatter: (params) => {
            const p = params[0];
            const item = raw[p.dataIndex];
            return `${item.tag}<br/>通过 ${item.solved}/${item.tried} 题<br/>通过率 ${item.rate}%`;
          },
        },
        xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
        yAxis: { type: 'category', data: raw.map((i) => i.tag), axisLabel: { fontSize: 11 } },
        series: [{
          type: 'bar',
          data: raw.map((i) => i.rate),
          color: '#67C23A',
          barWidth: '55%',
          label: { show: true, position: 'right', formatter: '{c}%', fontSize: 11 },
        }],
      });
    },
    renderRatingTrend() {
      const el = document.getElementById("ratingTrend");
      if (!el || !this.ratingHistory.length) return;
      this.disposeChart('rating');
      const data = this.ratingHistory.slice().reverse();
      const values = data.map((i) => Number(i.newRating || 0));
      const min = Math.max(0, Math.min(...values) - 80);
      const max = Math.max(...values) + 80;
      this.charts.rating = chart.init(el);
      this.charts.rating.setOption({
        grid: { left: 44, top: 26, right: 18, bottom: 52 },
        tooltip: {
          trigger: 'axis',
          formatter: (params) => {
            const p = params[0];
            const item = data[p.dataIndex];
            return `${item.title}<br/>${item.start}<br/>Rating ${item.oldRating} → ${item.newRating}<br/>变化 ${this.signedDelta(item.delta)}`;
          },
        },
        xAxis: {
          type: 'category',
          data: data.map((i) => i.title),
          axisLabel: {
            interval: 0,
            rotate: data.length > 4 ? 30 : 0,
            formatter: (value) => value.length > 8 ? `${value.slice(0, 8)}...` : value,
          },
        },
        yAxis: {
          type: 'value',
          min,
          max,
          axisLabel: { fontSize: 10 },
        },
        series: [{
          type: 'line',
          data: values,
          smooth: true,
          symbolSize: 7,
          lineStyle: { width: 3, color: '#e6a23c' },
          itemStyle: { color: '#e6a23c' },
          areaStyle: { color: 'rgba(230, 162, 60, 0.14)' },
        }],
      });
    },
    async getUserClickData() {
      await axios.post('/api/rabbit/getClickData', {
        uid: this.uid,
        day: 14
      }).then(res => {
        this.date = [];
        this.clickCnt = [];
        for (let i = 0; i < res.data.data.length; i++) {
          this.date[i] = res.data.data[i].date;
          this.clickCnt[i] = res.data.data[i].clickCnt;
        }
      });
      if (this.activeTab === 'about') this.$nextTick(() => this.renderClickChart());
    },
    renderClickChart() {
      const el = document.getElementById("clickCnt");
      if (!el) return;
      if (!this.date.length) { this.disposeChart('click'); return; }
      this.disposeChart('click');
      this.charts.click = chart.init(el);
      this.charts.click.setOption({
        grid: { left: 8, top: 40, right: 8, bottom: 24, containLabel: true },
        title: { show: true, text: '兔兔每日点击数', left: 'center', top: 6, textStyle: { fontSize: 13 } },
        xAxis: { type: 'category', data: this.date, axisLabel: { fontSize: 10 } },
        yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
        tooltip: { show: true, trigger: 'axis', axisPointer: { type: 'shadow' } },
        series: [{
          name: '次数',
          type: 'bar',
          color: '#5470c6',
          barWidth: '55%',
          data: this.clickCnt
        }]
      });
    },
    resizeCharts() {
      Object.values(this.charts).forEach((c) => {
        if (!c || !c.getDom) return;
        // Skip charts whose container is in a hidden tab pane (0×0): resizing a
        // chart with no layout box makes echarts crash in its layout pass.
        const dom = c.getDom();
        if (!dom || !dom.offsetWidth || !dom.offsetHeight) return;
        // Guard against echarts' intermittent "reading 'type'" layout throw
        // when a chart is resized mid progressive-render (same class of error
        // main.js already swallows for ResizeObserver).
        try { c.resize(); } catch (_) { /* transient echarts layout hiccup */ }
      });
    },
    disposeChart(name) {
      if (this.charts[name] && this.charts[name].dispose) this.charts[name].dispose();
      delete this.charts[name];
    },
  },
  mounted() {
    this.loadRouteUser();
    window.addEventListener('resize', this.resizeCharts);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.resizeCharts);
    Object.values(this.charts).forEach((c) => c && c.dispose && c.dispose());
  },
}
</script>

<style scoped>
.profile-page {
  margin: auto;
  max-width: 1080px;
  min-width: 0;
}

/* ── Hero ──────────────────────────────────────────────── */
.profile-hero {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(31, 45, 61, 0.06);
}

.hero-banner {
  height: 104px;
  background: linear-gradient(120deg, #409EFF 0%, #5a8dff 45%, #7c6cf6 100%);
}

.hero-inner {
  display: flex;
  align-items: flex-end;
  gap: 20px;
  padding: 0 28px 18px;
  margin-top: -54px;
}

.hero-avatar {
  flex-shrink: 0;
  border: 4px solid #fff;
  box-shadow: 0 4px 12px rgba(31, 45, 61, 0.12);
  background: #fff;
}

.hero-main {
  flex: 1;
  min-width: 0;
  padding-bottom: 2px;
}

.hero-name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

#name {
  font-size: 24px;
  font-weight: 700;
  color: #1f2d3d;
  line-height: 1.2;
}

.username {
  color: #909399;
  font-size: 14px;
}

.role-tag {
  font-weight: 600;
}

.bio {
  margin: 8px 0 0;
  color: #606266;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  margin-top: 10px;
  color: #909399;
  font-size: 13px;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.meta-item .el-icon {
  font-size: 14px;
}

.meta-link {
  color: #409EFF;
  text-decoration: none;
  font-weight: 600;
}

.meta-link:hover {
  text-decoration: underline;
}

.hero-actions {
  flex-shrink: 0;
  padding-bottom: 2px;
}

.hero-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid #f0f2f5;
}

.stat-tile {
  padding: 14px 12px 16px;
  text-align: center;
  text-decoration: none;
  border-left: 1px solid #f0f2f5;
  transition: background 0.15s;
}

.stat-tile:first-child {
  border-left: none;
}

a.stat-tile:hover {
  background: #f5f9ff;
}

.tile-value {
  font-size: 26px;
  font-weight: 700;
  color: #1f2d3d;
  line-height: 1.1;
}

.tile-value.accepted {
  color: #19be6b;
}

.tile-label {
  margin-top: 4px;
  font-size: 13px;
  color: #909399;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.tier-badge {
  padding: 1px 7px;
  border: 1px solid;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

/* ── Tabs ──────────────────────────────────────────────── */
.profile-tabs {
  margin-top: 16px;
}

.profile-tabs :deep(.el-tabs__item) {
  font-size: 15px;
  font-weight: 600;
}

/* ── Mini stat strip (per tab) ─────────────────────────── */
.stat-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
}

.mini-stat {
  flex: 1;
  min-width: 130px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 14px 18px;
  text-decoration: none;
  box-shadow: 0 2px 8px rgba(31, 45, 61, 0.04);
  transition: box-shadow 0.15s;
}

a.mini-stat:hover {
  box-shadow: 0 4px 14px rgba(31, 45, 61, 0.1);
}

.mini-value {
  font-size: 24px;
  font-weight: 700;
  color: #1f2d3d;
  line-height: 1.1;
}

.mini-value.accepted {
  color: #19be6b;
}

.mini-value.rank {
  color: #409EFF;
}

.mini-label {
  margin-top: 4px;
  font-size: 13px;
  color: #909399;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ── Chart panels ──────────────────────────────────────── */
.panel-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.stat-panel {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(31, 45, 61, 0.04);
  margin-bottom: 14px;
}

.panel-grid .stat-panel {
  margin-bottom: 0;
}

.chart-box {
  width: 100%;
  height: 300px;
}

.chart-box.heat-box {
  height: 200px;
}

.chart-box.tall-box {
  height: 320px;
}

.chart-box.click-box {
  height: 280px;
}

.motto-card,
.about-card,
.rating-history-card {
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(31, 45, 61, 0.04);
  margin-bottom: 14px;
}

#main {
  min-height: 160px;
  max-height: 460px;
  overflow-y: auto;
}

.card-title {
  font-size: 15px;
  font-weight: 700;
  color: #303133;
}

/* ── About ─────────────────────────────────────────────── */
.about-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 16px 24px;
}

.about-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 12px;
  border-bottom: 1px solid #f3f4f7;
}

.about-label {
  font-size: 12px;
  color: #a0a4ad;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.about-value {
  font-size: 15px;
  color: #303133;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.about-value.accepted {
  color: #19be6b;
}

/* ── Rating ────────────────────────────────────────────── */
.rating-cache-alert {
  margin-bottom: 14px;
}

.rating-trend {
  width: 100%;
  height: 240px;
  margin-bottom: 8px;
}

.contest-link {
  color: #409EFF;
  font-weight: 600;
  text-decoration: none;
}

.rating-date {
  margin-top: 2px;
  color: #909399;
  font-size: 12px;
}

.rating-delta {
  color: #909399;
  font-weight: 700;
}

.rating-delta.positive {
  color: #67c23a;
}

.rating-delta.negative {
  color: #f56c6c;
}

.rating-history-actions {
  margin-top: 12px;
  text-align: center;
}

/* ── Responsive ────────────────────────────────────────── */
@media (max-width: 768px) {
  .profile-page {
    width: 100%;
  }

  .hero-inner {
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 12px;
  }

  .hero-name-row {
    justify-content: center;
  }

  .hero-meta {
    justify-content: center;
  }

  .hero-stats {
    grid-template-columns: repeat(2, 1fr);
  }

  .stat-tile:nth-child(3) {
    border-left: none;
  }

  .stat-tile:nth-child(n + 3) {
    border-top: 1px solid #f0f2f5;
  }

  .panel-grid {
    grid-template-columns: 1fr;
  }
}
</style>
