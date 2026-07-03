<template>
  <div v-if="finished && (ratingNoticeTitle || canShowRatingChanges)" class="rank-rating-bar">
    <el-alert v-if="ratingNoticeTitle" class="rank-rating-alert" :type="ratingAlertType" show-icon
      :closable="false" :title="ratingNoticeTitle" />
    <el-button v-if="canShowRatingChanges" class="rank-rating-button" type="primary" plain
      :loading="ratingChangesLoading" @click="openRatingChanges">
      Rating 变化
    </el-button>
  </div>
  <el-table :data="rankList.data" height="600px" :header-cell-style="{ textAlign: 'center' }" :cell-style="CellStyle"
    :row-style="{ height: '50px' }" :row-class-name="tableRowClassName" :cell-class-name="cellClassName"
    @cell-click="getExSubmission" v-loading="!finished">
    <el-table-column fixed="left" max-width="10%" min-width="60px">
      <template #header>
        <el-button circle @click="all" color="#626aef" plain>
          <el-icon>
            <Refresh />
          </el-icon>
        </el-button>
      </template>
      <template #default="scope">
        {{ scope.row.rank || scope.$index + 1 }}
      </template>
    </el-table-column>
    <el-table-column label="用户名" fixed="left" max-width="15%" min-width="150px">
      <template #default="scope">
        <router-link class="rlink" :to="'/user/' + scope.row.user.uid">{{ scope.row.user.name }}</router-link>
      </template>
    </el-table-column>
    <el-table-column label="总分" fixed="left" max-width="10%" min-width="100px">
      <template #default="scope">
        <div class="totScore" v-show="scope.row.submitted">{{ scope.row.totalScore }}</div>
        <div class="attach" v-show="scope.row.submitted">({{ scope.row.usedTime }} ms)</div>
        <span v-show="!scope.row.submitted"> / </span>
      </template>
    </el-table-column>
    <el-table-column v-for="(key, value) in rankList.problem" :key="value" max-width="10%" min-width="100px">
      <template #header>
        <router-link class="rlink" :to="'/contest/' + cid + '/problem/' + value"> {{ value }}</router-link>
        <div class="attach"> ({{ key }})</div>
      </template>
      <template #default="scope">
        <div :style="getScoreStyle(scope.row.detail[value], key)">{{ scope.row.detail[value] ?
          scope.row.detail[value].score : '/' }}</div>
        <div v-if="scope.row.detail[value] && scope.row.detail[value].score > 0" class="attach">
          ({{ scope.row.detail[value].time }} ms)</div>
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

export default {
  name: "rankList",
  data() {
    return {
      rankList: [],
      subList: [],
      ratingChanges: [],
      ratingChangesMeta: {},
      ratingChangesVisible: false,
      ratingChangesLoading: false,
      ratingChangesLimit: 100,
      isProblem: false,
      dialogVisible: false,
      cid: 0,
      finished: false
    };
  },
  computed: {
    ratingStatus() {
      if (this.rankList && this.rankList.ratingStatus) return this.rankList.ratingStatus;
      if (this.rankList && this.rankList.unrated) return { state: 'unrated', label: 'Unrated', type: 'info' };
      if (this.rankList && this.rankList.unsettled) return { state: 'pending', label: '待结算', type: 'warning' };
      return null;
    },
    hasRating() {
      return Array.isArray(this.rankList.data) && this.rankList.data.some(row => row.ratingChange);
    },
    canShowRatingChanges() {
      const status = this.ratingStatus;
      return !!status && !['rated', 'unrated'].includes(status.state) && this.hasRating;
    },
    ratingAlertType() {
      return this.normalizeAlertType(this.ratingStatus && this.ratingStatus.type);
    },
    ratingNoticeTitle() {
      return this.formatRatingNotice(this.ratingStatus, this.rankList);
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
    all() {
      this.finished = false;
      axios.post("/api/contest/getRank", {
        cid: this.cid
      }).then(res => {
        this.rankList = res.data;
        this.finished = true;
      }).catch(err => {
        this.$message.error("获取比赛排行失败" + err.message);
      });
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
      const rows = Number(status.rowCount || payload.ratingRowCount || (Array.isArray(payload.rating) ? payload.rating.length : 0));
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
      if (columnIndex === 2 && row.submitted || columnIndex > 2 && row['detail'][columnIndex - 2]) {
        style['cursor'] = 'pointer';
      }
      style['text-align'] = 'center';
      if (row['detail'][columnIndex - 2] && ('firstBlood' in row['detail'][columnIndex - 2])) {
        style['background'] = '#d9ecff';
      }
      return style;
    },
    tableRowClassName(obj) {
      return (obj.row.user.uid === store.state.uid ? 'success' : '');
    },
    cellClassName({ column, columnIndex }) {
      column.index = columnIndex;
    },
    getExSubmission(row, column) {
      this.isProblem = false;
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
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
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
