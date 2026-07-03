<template>
  <div v-if="finished && (ratingNoticeTitle || canShowRatingChanges)" class="rank-rating-bar">
    <el-alert v-if="ratingNoticeTitle" class="rank-rating-alert" :type="ratingAlertType" show-icon
      :closable="false" :title="ratingNoticeTitle" />
    <el-button v-if="canShowRatingChanges" class="rank-rating-button" type="primary" plain
      :loading="ratingChangesLoading" @click="openRatingChanges">
      Rating 变化
    </el-button>
  </div>

  <!-- 时间轴：拖动查看任意时刻榜单 -->
  <div class="timeline-bar">
    <el-button circle size="small" color="#626aef" plain @click="all">
      <el-icon><Refresh /></el-icon>
    </el-button>
    <el-slider v-model="sliderSec" class="timeline-slider" :min="0" :max="meta.horizonSec || 0"
      :format-tooltip="fmtClock" :marks="sliderMarks" @input="onSliderInput" />
    <span class="timeline-clock">{{ fmtClock(sliderSec) }}</span>
    <el-tag v-if="meta.frozen" type="warning" effect="dark">封榜中</el-tag>
    <el-button v-if="canManage && meta.frozen" size="small" type="warning" plain @click="reveal(true)">
      解榜
    </el-button>
  </div>

  <el-table :data="rows" :header-cell-style="{ textAlign: 'center' }" :cell-style="CellStyle"
    :row-style="{ height: '50px' }" :row-class-name="tableRowClassName" :cell-class-name="cellClassName"
    @cell-click="getExSubmission" v-loading="!finished">
    <el-table-column fixed="left" max-width="10%" min-width="60px" label="#">
      <template #default="scope">
        {{ scope.row.rank }}
      </template>
    </el-table-column>
    <el-table-column :label="meta.teamMode ? '队伍' : '用户名'" fixed="left" max-width="15%" min-width="150px">
      <template #default="scope">
        <span class="player-name" @click.stop="openPlayerChart(scope.row)">{{ scope.row.user.name }}</span>
        <div v-if="scope.row.members && scope.row.members.length" class="attach team-members-line">
          {{ scope.row.members.map(m => m.name).join(' / ') }}
        </div>
      </template>
    </el-table-column>
    <el-table-column :label="isAcm ? '过题数' : isCf ? '得分' : '总分'" fixed="left" max-width="10%" min-width="100px">
      <template #default="scope">
        <template v-if="isAcm">
          <div class="totScore" v-show="scope.row.submitted">{{ scope.row.solved }}</div>
          <div class="attach" v-show="scope.row.submitted">({{ fmtPenalty(scope.row.penalty) }})</div>
        </template>
        <template v-else-if="isCf">
          <div class="totScore" v-show="scope.row.submitted">{{ scope.row.totalScore }}</div>
          <div class="attach" v-show="scope.row.submitted && (scope.row.hackOk || scope.row.hackFail)">
            hack +{{ scope.row.hackOk || 0 }}/-{{ scope.row.hackFail || 0 }}
          </div>
        </template>
        <template v-else>
          <div class="totScore" v-show="scope.row.submitted">{{ scope.row.totalScore }}</div>
          <div class="attach" v-show="scope.row.submitted">({{ scope.row.usedTime }} ms)</div>
        </template>
        <span v-show="!scope.row.submitted"> / </span>
      </template>
    </el-table-column>
    <el-table-column v-for="(weight, idx) in problems" :key="idx" max-width="10%" min-width="100px">
      <template #header>
        <router-link class="rlink" :to="'/contest/' + cid + '/problem/' + idx"> {{ idx }}</router-link>
        <div v-if="!isAcm" class="attach"> ({{ weight }})</div>
      </template>
      <template #default="scope">
        <template v-if="isAcm">
          <div v-if="cellOf(scope.row, idx)" :class="acmCellClass(cellOf(scope.row, idx))">
            <template v-if="cellOf(scope.row, idx).masked">?{{ cellOf(scope.row, idx).masked }}</template>
            <template v-else-if="cellOf(scope.row, idx).ac">
              +{{ cellOf(scope.row, idx).tries || '' }}
              <div class="attach">{{ Math.floor(cellOf(scope.row, idx).time / 60) }}</div>
            </template>
            <template v-else-if="cellOf(scope.row, idx).pending">?</template>
            <template v-else-if="cellOf(scope.row, idx).tries">-{{ cellOf(scope.row, idx).tries }}</template>
            <template v-else>/</template>
          </div>
          <span v-else>/</span>
        </template>
        <template v-else-if="isCf">
          <div v-if="cellOf(scope.row, idx)" :class="acmCellClass(cellOf(scope.row, idx))">
            <template v-if="cellOf(scope.row, idx).masked">?{{ cellOf(scope.row, idx).masked }}</template>
            <template v-else-if="cellOf(scope.row, idx).ac">
              {{ cellOf(scope.row, idx).points }}
              <div class="attach">{{ Math.floor(cellOf(scope.row, idx).time / 60) }}′{{ cellOf(scope.row, idx).tries ? ' / -' + cellOf(scope.row, idx).tries : '' }}</div>
            </template>
            <template v-else-if="cellOf(scope.row, idx).pending">?</template>
            <template v-else-if="cellOf(scope.row, idx).hacked">
              ⚡-{{ cellOf(scope.row, idx).tries }}
            </template>
            <template v-else-if="cellOf(scope.row, idx).tries">-{{ cellOf(scope.row, idx).tries }}</template>
            <template v-else>/</template>
          </div>
          <span v-else>/</span>
        </template>
        <template v-else>
          <div v-if="cellOf(scope.row, idx) && cellOf(scope.row, idx).masked" class="acm-masked">
            ?{{ cellOf(scope.row, idx).masked }}
          </div>
          <template v-else>
            <div :style="getScoreStyle(cellOf(scope.row, idx), weight)">
              {{ cellOf(scope.row, idx) ? cellOf(scope.row, idx).score : '/' }}
            </div>
            <div v-if="cellOf(scope.row, idx) && cellOf(scope.row, idx).score > 0" class="attach">
              ({{ cellOf(scope.row, idx).time }} ms)
            </div>
          </template>
        </template>
      </template>
    </el-table-column>
    <el-table-column v-if="hasRating" label="Rating" min-width="130px">
      <template #default="scope">
        <div v-if="scope.row.ratingChange">
          <span class="rating-new">{{ scope.row.ratingChange.newRating }}</span>
          <span :class="ratingDeltaClass(scope.row.ratingChange.delta)">
            {{ signedDelta(scope.row.ratingChange.delta) }}
          </span>
          <span class="rating-tier" :style="{
            color: ratingTier(scope.row.ratingChange.newRating).color,
            backgroundColor: ratingTier(scope.row.ratingChange.newRating).bg,
            borderColor: ratingTier(scope.row.ratingChange.newRating).color,
          }">{{ ratingTier(scope.row.ratingChange.newRating).label }}</span>
          <div class="attach">{{ scope.row.ratingChange.oldRating }} → {{ scope.row.ratingChange.newRating }}</div>
        </div>
        <span v-else>/</span>
      </template>
    </el-table-column>
  </el-table>
  <el-pagination v-if="total > pageSize" class="rank-pagination" layout="prev, pager, next, sizes, total"
    :total="total" v-model:current-page="pageId" v-model:page-size="pageSize"
    :page-sizes="[20, 50, 100]" @current-change="fetchRank" @size-change="fetchRank" />

  <!-- 选手 分数/排名 时间曲线 -->
  <el-dialog v-model="chartVisible" :title="chartTitle" width="900px" destroy-on-close
    @opened="renderPlayerChart" @closed="disposePlayerChart">
    <div ref="playerChart" style="width: 100%; height: 420px;" v-loading="chartLoading"></div>
  </el-dialog>

  <el-dialog v-if="dialogVisible" v-model="dialogVisible" title="提交记录" width="1300px" center
    style="border-radius: 10px; padding-bottom: 10px;" class="pd">
    <el-divider />
    <el-table :data="subList" style="min-height: 200px; width: auto; margin-left: 10px;margin-right: 10px;"
      :header-cell-style="{ textAlign: 'center' }" :cell-style="submissionCellStyle"
      :row-class-name="submissionTableRowClassName">
      <el-table-column prop="title" label="题目" min-width="20%">
        <template #default="scope">
          <router-link class="rlink" :to="'/contest/' + cid + '/problem/' + scope.row.idx">
            {{ scope.row.title }}
          </router-link>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="提交者" min-width="15%">
        <template #default="scope">
          <router-link class="rlink" :to="'/user/' + scope.row.uid">
            {{ scope.row.name }}
          </router-link>
        </template>
      </el-table-column>
      <el-table-column prop="judgeResult" label="评测状态" min-width="17%">
        <template #default="scope">
          <span style="cursor: pointer;"
            @click="this.$router.push({ path: '/submission/' + scope.row.sid, query: { isContest: true } })">
            {{ scope.row.judgeResult }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="score" label="分数" min-width="10%">
        <template #default="scope">
          <span> {{ scope.row.score }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="codeLength" label="语言 / 代码长度" min-width="15%">
        <template #default="scope">
          <span v-if="scope.row.lang == null">答案 / {{ scope.row.codeLength }} B</span>
          <span v-else>{{ $store.state.langList[scope.row.lang].des }} / {{ scope.row.codeLength }} B </span>
        </template>
      </el-table-column>
      <el-table-column prop="submitTime" label="提交时间" min-width="15%" />
      <el-table-column prop="machine" label="评测机" min-width="18%" />
    </el-table>
  </el-dialog>

  <el-dialog v-model="ratingChangesVisible" title="Rating 变化" width="780px" destroy-on-close>
    <div class="rating-change-meta">
      <el-tag :type="ratingChangesAlertType">{{ ratingChangesStatusText }}</el-tag>
      <span>{{ ratingChangesNoticeTitle }}</span>
      <span v-if="ratingChangesMeta.totalCount != null" class="rating-change-count">
        显示 {{ ratingChanges.length || 0 }} / {{ ratingChangesMeta.totalCount || 0 }}
      </span>
    </div>
    <el-table :data="ratingChanges" v-loading="ratingChangesLoading" max-height="520" empty-text="暂无 Rating 变化">
      <el-table-column prop="rank" label="排名" width="80" />
      <el-table-column label="用户" min-width="150">
        <template #default="scope">
          <router-link class="rlink" :to="'/user/' + scope.row.uid">{{ scope.row.username || scope.row.uid }}</router-link>
        </template>
      </el-table-column>
      <el-table-column prop="totalScore" label="分数" width="90" />
      <el-table-column prop="usedTime" label="用时" width="100" />
      <el-table-column label="Rating" min-width="160">
        <template #default="scope">
          <span class="rating-new">{{ scope.row.newRating }}</span>
          <span class="attach"> {{ scope.row.oldRating }} → {{ scope.row.newRating }}</span>
        </template>
      </el-table-column>
      <el-table-column label="变化" width="90">
        <template #default="scope">
          <el-tag :type="ratingDeltaType(scope.row.delta)" effect="dark">
            {{ signedDelta(scope.row.delta) }}
          </el-tag>
        </template>
      </el-table-column>
    </el-table>
    <div class="rating-change-actions" v-if="ratingChangesHasMore">
      <el-button size="small" plain :loading="ratingChangesLoading" @click="loadMoreRatingChanges">
        加载更多
      </el-button>
    </div>
  </el-dialog>
</template>

<script>
import axios from "axios"
import { getRatingTier, scoreColor, resColor } from '@/assets/common'
import store from "@/sto/store";
import echarts from '@/chart/myChart';

export default {
  name: "rankList",
  props: {
    canManage: { type: Boolean, default: false },
  },
  data() {
    return {
      rows: [],
      problems: {},
      meta: {},
      total: 0,
      pageId: 1,
      pageSize: 50,
      sliderSec: 0,
      sliderDebounce: null,
      atLatest: true, // 滑块在最右端时刷新自动跟随最新
      subList: [],
      ratingChanges: [],
      ratingChangesMeta: {},
      ratingChangesVisible: false,
      ratingChangesLoading: false,
      ratingChangesLimit: 100,
      isProblem: false,
      dialogVisible: false,
      chartVisible: false,
      chartLoading: false,
      chartTitle: '',
      chartUid: 0,
      chartData: null,
      chartInstance: null,
      cid: 0,
      finished: false
    };
  },
  computed: {
    isAcm() {
      return this.meta.format === 'acm';
    },
    isCf() {
      return this.meta.format === 'cf';
    },
    sliderMarks() {
      const marks = {};
      if (this.meta.freezeStartSec != null && this.meta.frozen) {
        marks[this.meta.freezeStartSec] = '封榜';
      }
      return marks;
    },
    ratingStatus() {
      if (this.meta && this.meta.ratingStatus) return this.meta.ratingStatus;
      return null;
    },
    hasRating() {
      return Array.isArray(this.rows) && this.rows.some(row => row.ratingChange);
    },
    canShowRatingChanges() {
      return this.meta.done && this.hasRating;
    },
    ratingAlertType() {
      return this.normalizeAlertType(this.ratingStatus && this.ratingStatus.type);
    },
    ratingNoticeTitle() {
      return this.formatRatingNotice(this.ratingStatus, this.meta);
    },
    ratingChangesStatus() {
      if (this.ratingChangesMeta && this.ratingChangesMeta.ratingStatus) return this.ratingChangesMeta.ratingStatus;
      return this.ratingStatus;
    },
    ratingChangesAlertType() {
      return this.normalizeAlertType(this.ratingChangesStatus && this.ratingChangesStatus.type);
    },
    ratingChangesStatusText() {
      const status = this.ratingChangesStatus;
      if (status && status.label) return status.label;
      return this.ratingChangesMeta.unrated ? 'Unrated' : 'Rated';
    },
    ratingChangesNoticeTitle() {
      return this.formatRatingNotice(this.ratingChangesStatus, this.ratingChangesMeta);
    },
    ratingChangesHasMore() {
      return !!(this.ratingChangesMeta && this.ratingChangesMeta.hasMoreChanges);
    },
  },
  methods: {
    fmtClock(sec) {
      const s = Math.max(0, Math.floor(Number(sec) || 0));
      const h = String(Math.floor(s / 3600)).padStart(2, '0');
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      return `${h}:${m}:${ss}`;
    },
    fmtPenalty(sec) {
      return Math.floor((Number(sec) || 0) / 60) + ' min';
    },
    cellOf(row, idx) {
      return row.detail ? row.detail[idx] : null;
    },
    acmCellClass(cell) {
      if (cell.masked) return 'acm-masked';
      if (cell.ac) return 'acm-ac';
      if (cell.pending) return 'acm-pending';
      if (cell.tries) return 'acm-fail';
      return '';
    },
    all() {
      this.atLatest = true;
      this.fetchRank();
    },
    onSliderInput() {
      this.atLatest = this.sliderSec >= (this.meta.horizonSec || 0);
      clearTimeout(this.sliderDebounce);
      this.sliderDebounce = setTimeout(() => this.fetchRank(false), 250);
    },
    fetchRank(followLatest = true) {
      this.finished = false;
      const body = { cid: this.cid, pageId: this.pageId, pageSize: this.pageSize };
      // 滑块跟随最新时不传 t（服务端取当前进度）；否则回放指定时刻
      if (!(followLatest && this.atLatest)) body.t = this.sliderSec;
      axios.post("/api/contest/getRankAt", body).then(res => {
        this.rows = res.data.data || [];
        this.problems = res.data.problem || {};
        this.total = res.data.total || 0;
        this.meta = res.data;
        if (this.atLatest) this.sliderSec = res.data.atSec;
        this.finished = true;
        this.fetchRatingMeta();
      }).catch(err => {
        this.finished = true;
        this.$message.error("获取比赛排行失败" + (err.message || ''));
      });
    },
    // rating 状态条沿用 getRank 的 meta（仅赛后需要）
    fetchRatingMeta() {
      if (!this.meta.done || this.meta.ratingStatus) return;
      axios.post("/api/contest/getRank", { cid: this.cid }).then(res => {
        this.meta = { ...this.meta, ratingStatus: res.data.ratingStatus, unrated: res.data.unrated };
      }).catch(() => { });
    },
    reveal(revealed) {
      axios.post('/api/contest/setScoreboardReveal', { cid: this.cid, revealed }).then(() => {
        this.$message.success(revealed ? '已解榜' : '已封榜');
        this.all();
      }).catch(err => {
        this.$message.error('操作失败' + (err.message || ''));
      });
    },
    openPlayerChart(row) {
      this.chartTitle = `${row.user.name} — 分数 / 排名曲线`;
      this.chartUid = row.user.uid;
      this.chartVisible = true;
      this.chartLoading = true;
      axios.post('/api/contest/getParticipantTimeline', { cid: this.cid, participant: row.key }).then(res => {
        this.chartData = res.data;
        this.chartLoading = false;
        this.renderPlayerChart();
      }).catch(err => {
        this.chartLoading = false;
        this.$message.error('获取选手曲线失败' + (err.message || ''));
      });
    },
    renderPlayerChart() {
      const el = this.$refs.playerChart;
      if (!el || !this.chartData || !this.chartVisible) return;
      // echarts 在 0 尺寸容器上 init/resize 会崩：跳过 + try/catch 兜底
      if (!el.clientWidth || !el.clientHeight) return;
      try {
        if (!this.chartInstance) this.chartInstance = echarts.init(el);
        const pts = this.chartData.points || [];
        const playerCount = this.chartData.playerCount || 1;
        const scoreLabel = this.chartData.format === 'acm' ? '过题数' : '分数';
        this.chartInstance.setOption({
          tooltip: {
            trigger: 'axis',
            formatter: (params) => {
              const t = this.fmtClock(params[0].axisValue);
              const lines = params.map(p => `${p.marker}${p.seriesName}: ${p.value[1]}`);
              return `${t}<br/>${lines.join('<br/>')}`;
            },
          },
          legend: { data: ['排名', scoreLabel] },
          grid: { left: 60, right: 60, top: 40, bottom: 40 },
          xAxis: {
            type: 'value', min: 0, max: this.chartData.horizonSec || undefined,
            axisLabel: { formatter: (v) => this.fmtClock(v) },
            splitLine: { show: false },
          },
          yAxis: [
            {
              type: 'value', name: '排名', inverse: true, min: 1, max: playerCount,
              minInterval: 1, position: 'left',
            },
            { type: 'value', name: scoreLabel, position: 'right', splitLine: { show: false } },
          ],
          series: [
            {
              name: '排名', type: 'line', step: 'end', yAxisIndex: 0, symbol: 'circle',
              data: pts.map(p => [p.t, p.rank]), lineStyle: { width: 2 }, color: '#2f8f83',
            },
            {
              name: scoreLabel, type: 'line', step: 'end', yAxisIndex: 1, symbol: 'circle',
              data: pts.map(p => [p.t, p.score]), lineStyle: { width: 2 }, color: '#b03a2e',
            },
          ],
        });
      } catch (e) {
        // 图表渲染失败不影响榜单
        console.warn('player chart render failed', e);
      }
    },
    disposePlayerChart() {
      try {
        if (this.chartInstance) { this.chartInstance.dispose(); this.chartInstance = null; }
      } catch (e) { this.chartInstance = null; }
      this.chartData = null;
    },
    openRatingChanges() {
      this.ratingChangesVisible = true;
      this.ratingChanges = [];
      this.ratingChangesMeta = {};
      this.loadRatingChanges(false);
    },
    loadRatingChanges(append = false) {
      if (this.ratingChangesLoading) return;
      this.ratingChangesLoading = true;
      const offset = append ? this.ratingChanges.length : 0;
      axios.post('/api/contest/getRatingChanges', {
        cid: this.cid,
        offset,
        limit: this.ratingChangesLimit,
      }).then(res => {
        const rows = res.data.data || [];
        this.ratingChanges = append ? this.ratingChanges.concat(rows) : rows;
        this.ratingChangesMeta = res.data || {};
      }).catch(err => {
        this.$message.error("获取 Rating 变化失败" + err.message);
      }).finally(() => {
        this.ratingChangesLoading = false;
      });
    },
    loadMoreRatingChanges() {
      this.loadRatingChanges(true);
    },
    normalizeAlertType(type) {
      if (type === 'danger') return 'error';
      return type || 'info';
    },
    formatRatingNotice(status, meta) {
      if (!status) return '';
      const payload = meta || {};
      const submitted = Number(status.submittedUserCount || payload.submittedUserCount || 0);
      const pending = Number(status.pendingJudgementCount || payload.pendingJudgementCount || 0);
      const pendingDetail = this.pendingJudgementDetailText(status, payload);
      const invalid = Number(status.invalidLastSubmissionCount || payload.invalidLastSubmissionCount || 0);
      const invalidText = invalid ? `，另有 ${invalid} 条无效最后提交未计入` : '';
      const rows = Number(status.rowCount || payload.ratingRowCount || 0);
      const min = Number(status.minParticipantCount || payload.minParticipantCount || 2);
      switch (status.state) {
        case 'settled':
          return rows ? `Rating 已结算，共 ${rows} 名选手产生变化` : 'Rating 已结算';
        case 'judging':
          return `还有 ${pending} 个最后提交未完成评测${pendingDetail}${invalidText}，完成后才能结算 Rating`;
        case 'pending':
          return `Rating 待结算，已有 ${submitted} 名有效提交选手${invalidText}`;
        case 'skipped':
          return `有效提交选手 ${submitted}/${min}${invalidText}，样本不足，不产生 Rating`;
        case 'rated':
          return `本场参与 Rating，当前有效提交选手 ${submitted} 名${invalidText}`;
        case 'unrated':
          return '本场不参与 Rating';
        default:
          return status.label || '';
      }
    },
    pendingJudgementDetailText(status, payload) {
      const meta = payload || {};
      const userCount = Number(status && status.pendingJudgementUserCount || meta.pendingJudgementUserCount || 0);
      const problemCount = Number(status && status.pendingJudgementProblemCount || meta.pendingJudgementProblemCount || 0);
      const parts = [];
      if (userCount) parts.push(`${userCount} 名用户`);
      if (problemCount) parts.push(`${problemCount} 题`);
      return parts.length ? `（${parts.join(' / ')}）` : '';
    },
    getScoreStyle(cur, total) {
      if (!cur)
        return {};
      else {
        let style = {};
        style["line-height"] = "1.2em";
        style["font-size"] = "15px";
        style["font-weight"] = 800;
        style["color"] = scoreColor[Math.floor(cur.score * 10 / total)];
        return style;
      }
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
    ratingDeltaType(delta) {
      const value = Number(delta || 0);
      if (value > 0) return 'success';
      if (value < 0) return 'danger';
      return 'info';
    },
    ratingTier(rating) {
      return getRatingTier(rating);
    },
    CellStyle({ row, columnIndex }) {
      let style = {};
      const idx = columnIndex - 2;
      if (columnIndex === 2 && row.submitted || idx > 0 && row.detail && row.detail[idx]) {
        style['cursor'] = 'pointer';
      }
      style['text-align'] = 'center';
      if (idx > 0 && row.detail && row.detail[idx] && row.detail[idx].firstBlood) {
        style['background'] = '#d9ecff';
      }
      return style;
    },
    tableRowClassName(obj) {
      if (obj.row.mine !== undefined) return obj.row.mine ? 'success' : '';
      return (obj.row.user.uid === store.state.uid ? 'success' : '');
    },
    cellClassName({ column, columnIndex }) {
      column.index = columnIndex;
    },
    getExSubmission(row, column) {
      this.isProblem = false;
      // 组队模式：提交按 uid 存储，单元格点击弹窗暂不支持按队聚合
      if (this.meta.teamMode) return;
      if (column.index - 2 < 0) return;
      if (column.index - 2 === 0 && row.submitted) {
        this.dialogVisible = true;
        axios.post('/api/contest/getSingleUserLastSubmission', {
          cid: this.cid,
          uid: row.user.uid
        }).then(res => {
          this.subList = res.data.data;
        });
      } else if (row.detail[column.index - 2]) {
        this.dialogVisible = true;
        this.isProblem = true;
        axios.post('/api/contest/getSingleUserProblemSubmission', {
          cid: this.cid,
          uid: row.user.uid,
          idx: column.index - 2
        }).then(res => {
          this.subList = res.data.data;
        });
      }
    },
    submissionTableRowClassName({ rowIndex }) {
      if (!this.isProblem)
        return 'warning';
      else
        return (rowIndex === 0 ? 'warning' : '');
    },
    submissionCellStyle({ row, columnIndex }) {
      let style = {};
      style['textAlign'] = 'center';
      if (columnIndex === 2) {
        style['font-weight'] = 500;
        style['color'] = resColor[row.judgeResult];
      }
      if (columnIndex === 3) {
        style['font-weight'] = 500;
        style['color'] = scoreColor[Math.floor(row.score / 10)];
      }
      return style;
    }
  },
  mounted() {
    this.cid = this.$route.params.cid;
    this.all();
  },
  beforeUnmount() {
    clearTimeout(this.sliderDebounce);
    this.disposePlayerChart();
  },
}
</script>

<style scoped>
.attach {
  line-height: 1em;
  font-size: 12px;
  color: var(--el-table-header-text-color);
  font-weight: 400;
}

.totScore {
  line-height: 1.2em;
  font-size: 15px;
  font-weight: 500;
}

.timeline-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 4px 6px 12px 6px;
}

.timeline-slider {
  flex: 1;
}

.timeline-clock {
  font-family: 'Courier New', monospace;
  font-size: 20px;
  font-weight: 700;
  color: #909399;
  min-width: 110px;
  text-align: right;
}

.player-name {
  cursor: pointer;
  color: var(--el-color-primary);
  font-weight: 500;
}

.player-name:hover {
  text-decoration: underline;
}

.team-members-line {
  margin-top: 2px;
}

.rank-pagination {
  margin-top: 12px;
  justify-content: center;
}

.acm-ac {
  color: #67c23a;
  font-weight: 800;
  font-size: 15px;
  line-height: 1.2em;
}

.acm-fail {
  color: #f56c6c;
  font-weight: 800;
  font-size: 15px;
}

.acm-pending,
.acm-masked {
  color: #e6a23c;
  font-weight: 800;
  font-size: 15px;
}

.rank-rating-bar {
  display: flex;
  gap: 10px;
  align-items: stretch;
  margin-bottom: 10px;
}

.rank-rating-alert {
  flex: 1;
}

.rank-rating-button {
  flex: none;
}

.rating-change-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  color: #606266;
}

.rating-change-count {
  color: #909399;
  font-size: 12px;
}

.rating-change-actions {
  margin-top: 12px;
  text-align: center;
}

.rating-new {
  font-weight: 800;
}

.rating-delta {
  margin-left: 6px;
  color: #909399;
  font-weight: 700;
}

.rating-delta.positive {
  color: #67c23a;
}

.rating-delta.negative {
  color: #f56c6c;
}

.rating-tier {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border: 1px solid;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}
</style>
