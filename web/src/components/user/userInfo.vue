<template>
  <div class="profile-page">
    <el-row :gutter="16">
      <el-col :span="7">
        <div class="profile-side">
          <el-avatar shape="square" :size="230" :src="avatarAddress" />
          <div id="name">{{ info.name }}</div>
          <el-button v-if="$store.state.uid === Number(uid)" type="info" plain @click="$router.push('/user/edit')"
            id="modify">修改资料</el-button>
          <div v-if="info.email" class="infos">
            <span class="subtitle">邮箱</span>
            <span class="info-val">{{ info.email }}</span>
          </div>
          <div class="infos" v-if="roleLabels.length">
            <span class="subtitle">用户类型</span>
            <span class="info-val">
              <el-tag v-for="r in roleLabels" :key="r" size="small" style="margin-left: 4px;">{{ r }}</el-tag>
            </span>
          </div>
          <div class="infos">
            <span class="subtitle">注册时间</span>
            <span class="info-val">{{ info.reg_time }}</span>
          </div>
          <div v-if="info.login_time" class="infos">
            <span class="subtitle">登录时间</span>
            <span class="info-val">{{ info.login_time }}</span>
          </div>
          <div class="infos">
            <span class="subtitle">兔兔点击数</span>
            <span class="info-val">{{ info.clickCnt }}</span>
          </div>
          <div class="infos">
            <span class="subtitle">提交数</span>
            <span class="info-val">{{ submissionStats.total || 0 }}</span>
          </div>
          <div class="infos">
            <span class="subtitle">AC</span>
            <span class="info-val accepted">{{ submissionStats.accepted || 0 }}</span>
          </div>
        </div>
      </el-col>
      <el-col :span="17">
        <div class="stats-grid">
          <div class="stat-panel heat-panel">
            <div id="submissionHeat" class="chart-box"></div>
          </div>
          <div class="stat-panel">
            <div id="resultStat" class="chart-box small"></div>
          </div>
          <div class="stat-panel">
            <div id="clickCnt" class="chart-box small"></div>
          </div>
        </div>
        <el-card id="main" shadow="never">
          <v-md-preview :text="info.motto" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script>
import axios from "axios";
import chart from '@/chart/myChart';
import { resColor } from '@/assets/common';

export default {
  name: "userInfo",
  data() {
    return {
      uid: 0,
      info: {},
      avatarAddress: '',
      roleLabel: {
        user: '普通用户',
        problem_setter: '出题人',
        contest_manager: '比赛管理员',
        judge_admin: '判题管理员',
        moderator: '管理员',
        super_admin: '超级管理员',
      },
      submissionStats: { heatmap: [], results: [], total: 0, accepted: 0 },
      date: [],
      clickCnt: [],
      charts: {},
    }
  },
  computed: {
    roleLabels() {
      const roles = (this.info && this.info.roles) || [];
      return roles
        .filter((k) => k !== 'user')
        .map((k) => this.roleLabel[k] || k);
    },
  },
  methods: {
    all() {
      axios.post('/api/user/getUserPublicInfo', {
        uid: this.uid
      }).then((res) => {
        if (res.data.info) {
          this.info = res.data.info;
          if (!this.info.motto) this.info.motto = "Ta暂时没有编辑个人主页噢";
          this.submissionStats = this.info.submissionStats || { heatmap: [], results: [], total: 0, accepted: 0 };
          this.avatarAddress = this.getAvatarAddress(this.info.qq);
          this.$nextTick(() => {
            this.renderSubmissionHeat();
            this.renderResultStat();
          });
        } else {
          this.$message.error('获取用户信息失败');
        }
      });
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
      start.setDate(end.getDate() - 89);
      return [this.dateText(start), this.dateText(end)];
    },
    renderSubmissionHeat() {
      const el = document.getElementById("submissionHeat");
      if (!el) return;
      const rawData = this.submissionStats.heatmap || [];
      if (!rawData.length) return;
      const data = rawData.map((i) => [i.date, i.cnt]);
      const max = Math.max(1, ...data.map((i) => i[1]));
      this.charts.heat = this.charts.heat || chart.init(el);
      this.charts.heat.setOption({
        title: { text: '最近 90 天提交热度', left: 'center', top: 6, textStyle: { fontSize: 13 } },
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
          inRange: { color: ['#eef6ff', '#409EFF'] },
        },
        calendar: {
          top: 38,
          left: 28,
          right: 18,
          bottom: 34,
          range: this.heatRange(),
          cellSize: ['auto', 16],
          splitLine: { lineStyle: { color: '#ebeef5' } },
          itemStyle: { borderWidth: 1, borderColor: '#fff' },
          yearLabel: { show: false },
          monthLabel: { fontSize: 10, color: '#909399' },
          dayLabel: { firstDay: 1, fontSize: 10, color: '#909399' },
        },
        series: [{ type: 'heatmap', coordinateSystem: 'calendar', data }],
      });
    },
    renderResultStat() {
      const el = document.getElementById("resultStat");
      if (!el) return;
      const rawResults = this.submissionStats.results || [];
      if (!rawResults.length) return;
      const data = rawResults.map((i) => ({
        name: i.result,
        value: i.cnt,
        itemStyle: { color: resColor[i.result] || '#909399' },
      }));
      this.charts.result = this.charts.result || chart.init(el);
      this.charts.result.setOption({
        title: { text: '提交结果统计', left: 'center', top: 6, textStyle: { fontSize: 13 } },
        tooltip: { trigger: 'item' },
        legend: { type: 'scroll', bottom: 0, itemWidth: 9, itemHeight: 9, textStyle: { fontSize: 10 } },
        series: [{
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['50%', '48%'],
          label: { show: false },
          data,
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
      this.$nextTick(() => this.renderClickChart());
    },
    renderClickChart() {
      const el = document.getElementById("clickCnt");
      if (!el) return;
      if (!this.date.length) return;
      this.charts.click = this.charts.click || chart.init(el);
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
      Object.values(this.charts).forEach((c) => c && c.resize());
    },
  },
  mounted() {
    this.uid = this.$route.params.uid;
    this.all();
    this.getUserClickData();
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
  min-width: 800px;
}

.profile-side {
  margin: 0 12px;
}

#name {
  font-size: 25px;
  font-weight: 600;
  margin: 10px 0 15px;
}

#modify {
  width: 230px;
  height: 35px;
  margin: 0 0 15px;
  font-size: 15px;
  font-weight: 600;
  color: #3f3f3f;
}

.infos {
  width: 230px;
  min-height: 30px;
  margin: 5px 0;
  font-size: 15px;
  font-weight: 500;
  color: #656565;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.subtitle {
  color: #3f3f3f;
  font-weight: 600;
  flex-shrink: 0;
}

.info-val {
  text-align: right;
  overflow-wrap: anywhere;
}

.accepted {
  color: #19be6b;
  font-weight: 700;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 10px;
}

.stat-panel {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}

.heat-panel {
  grid-column: 1 / 3;
}

.chart-box {
  width: 100%;
  height: 180px;
}

.chart-box.small {
  height: 190px;
}

#main {
  min-height: 260px;
  max-height: 420px;
  overflow-y: auto;
}
</style>
