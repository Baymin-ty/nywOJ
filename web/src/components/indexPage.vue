<template>
  <div class="page-wrap">
    <el-row :gutter="12">
      <!-- Left column -->
      <el-col :xs="24" :md="16">
        <!-- Announcements -->
        <el-card shadow="hover" class="mb-12">
          <template #header>
            <div class="card-header">
              <span>公告栏</span>
              <el-button v-if="gid === 3" type="danger" size="small" @click="addAnnouncement">
                <el-icon class="el-icon--left"><Plus /></el-icon>添加公告
              </el-button>
            </div>
          </template>
          <el-table :data="announcements" v-loading="!announcements.length" style="width:100%">
            <el-table-column prop="title" label="标题" min-width="65%">
              <template #default="scope">
                <router-link :to="'/announcement/' + scope.row.aid" class="rlink">{{ scope.row.title }}</router-link>
              </template>
            </el-table-column>
            <el-table-column prop="time" label="发布时间" min-width="35%" align="center" />
          </el-table>
        </el-card>

        <!-- Rabbit rank -->
        <el-card shadow="hover">
          <template #header>
            <div class="card-header">
              <span>点击数排名</span>
              <el-pagination
                small
                layout="prev, pager, next"
                :total="rankTotal"
                :page-size="10"
                :current-page="rankPage"
                @current-change="handleRankPage"
              />
            </div>
          </template>
          <el-table :data="rankList" v-loading="!rankLoaded" style="width:100%"
            :row-class-name="rankRowClass">
            <el-table-column prop="rank" label="#" width="50" align="center" />
            <el-table-column label="用户名" min-width="25%" align="center">
              <template #default="scope">
                <div class="rank-user">
                  <el-avatar :size="26" :src="scope.row.avatar || '/default-avatar.svg'" />
                  <router-link :to="'/user/' + scope.row.uid" class="rlink"
                    :style="{ color: getNameColor(scope.row.gid, scope.row.clickCnt),
                               fontWeight: scope.row.gid !== 1 ? 900 : 500 }">
                    {{ scope.row.name }}
                  </router-link>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="clickCnt" label="点击次数" min-width="20%" align="center" />
            <el-table-column label="个人主页" min-width="35%" class-name="hide-on-mobile">
              <template #default="scope">
                <span class="motto-cell">{{ scope.row.motto || '—' }}</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <!-- Right column -->
      <el-col :xs="24" :md="8">
        <!-- Hitokoto -->
        <el-card shadow="hover" class="mb-12">
          <template #header>
            <div class="card-header">
              <span>一言（ヒトコト）</span>
              <el-button type="primary" size="small" @click="updateHitokoto" color="#626aef" plain>
                <el-icon class="el-icon--left"><Refresh /></el-icon>再来一个
              </el-button>
            </div>
          </template>
          <p class="hitokoto-text">{{ motto.hitokoto }}</p>
          <p class="hitokoto-from">from {{ motto.from }}</p>
        </el-card>

        <!-- Rabbit click stats -->
        <el-card shadow="hover">
          <template #header><div class="card-header"><span>点击数统计</span></div></template>
          <div ref="chartContainer" class="chart-container"></div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script>
import axios from "axios";
import { getNameColor } from '@/assets/common';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

export default {
  name: "indexPage",
  data() {
    return {
      motto: { hitokoto: '…', from: '/' },
      announcements: [],
      gid: 0,
      rankList: [],
      rankLoaded: false,
      rankTotal: 0,
      rankPage: 1,
      myUid: 0,
    };
  },
  methods: {
    getNameColor,
    rankRowClass({ row }) {
      return row.uid === this.myUid ? 'success' : '';
    },
    updateHitokoto() {
      axios.post('/api/common/getHitokoto').then(res => {
        this.motto = res.status === 200 ? res.data : { hitokoto: '加载失败', from: '/' };
      }).catch(() => { this.motto = { hitokoto: '加载失败', from: '/' }; });
    },
    getAnnouncements() {
      axios.post('/api/common/getAnnouncementList').then(res => {
        this.announcements = res.data.data;
      });
    },
    getRankList() {
      this.rankLoaded = false;
      axios.post('/api/rabbit/getRankInfo', { pageId: this.rankPage }).then(res => {
        this.rankList = res.data.data || [];
        this.rankTotal = res.data.total || 0;
        this.rankLoaded = true;
      }).catch(() => { this.rankLoaded = true; });
    },
    handleRankPage(page) {
      this.rankPage = page;
      this.getRankList();
    },
    addAnnouncement() {
      axios.post('/api/admin/addAnnouncement').then(res => {
        if (res.status === 200) this.$router.push('/announcement/edit/' + res.data.aid);
        else this.$message.error('添加公告失败 ' + res.data.message);
      });
    },
    initChart() {
      axios.post('/api/rabbit/getClickData', { day: 7 }).then(res => {
        const data = res.data?.data || [];
        const dates       = data.map(d => d.date);
        const totalClicks = data.map(d => d.clickCnt);
        const userClicks  = data.map(d => d.userCnt);

        const chart = echarts.init(this.$refs.chartContainer);
        chart.setOption({
          tooltip: { trigger: 'axis' },
          grid: [
            { top: 20, bottom: '55%', left: 40, right: 10 },
            { top: '55%', bottom: 30, left: 40, right: 10 },
          ],
          xAxis: [
            { type: 'category', data: dates, gridIndex: 0, axisLabel: { fontSize: 10 } },
            { type: 'category', data: dates, gridIndex: 1, axisLabel: { fontSize: 10 } },
          ],
          yAxis: [
            { type: 'value', gridIndex: 0, axisLabel: { fontSize: 10 }, minInterval: 1 },
            { type: 'value', gridIndex: 1, axisLabel: { fontSize: 10 }, minInterval: 1 },
          ],
          series: [
            { name: '每日点击总次数', type: 'line', data: totalClicks, xAxisIndex: 0, yAxisIndex: 0, smooth: true, color: '#409EFF', areaStyle: { opacity: 0.1 } },
            { name: '每日点击用户数', type: 'line', data: userClicks,  xAxisIndex: 1, yAxisIndex: 1, smooth: true, color: '#67c23a', areaStyle: { opacity: 0.1 } },
          ],
        });
        window.addEventListener('resize', () => chart.resize());
      }).catch(() => {});
    },
  },
  mounted() {
    this.gid    = this.$store.state.gid;
    this.myUid  = this.$store.state.uid;
    this.updateHitokoto();
    this.getAnnouncements();
    this.getRankList();
    this.$nextTick(this.initChart);
  },
};
</script>

<style scoped>
.mb-12 { margin-bottom: 12px; }

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: bolder;
  color: #3f3f3f;
}

.hitokoto-text {
  font-size: 14px;
  line-height: 1.7;
  color: #2c3e50;
  margin: 0 0 12px;
}
.hitokoto-from {
  font-size: 12px;
  color: #909399;
  text-align: right;
  margin: 0;
}

.rank-user {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.motto-cell {
  font-size: 12px;
  color: #909399;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.chart-container {
  width: 100%;
  height: 260px;
}

@media (max-width: 768px) {
  .mb-12 { margin-bottom: 8px; }
  .chart-container { height: 200px; }
}
</style>
