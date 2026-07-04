<template>
  <div style="margin: auto; max-width: 1500px;">
    <el-row>
      <el-col :span="24">
        <el-card class="box-card" shadow="hover">
          <template #header>
            <div class="card-header">
              <p class="title">{{ contestInfo.title }}
                <el-button v-show="contestInfo.regAble" type="danger" plain @click="regContest">点击报名</el-button>
                <el-button v-show="contestInfo.isReg" type="info" disabled>已报名</el-button>
              </p>
            </div>
          </template>
          <el-descriptions :column="6" size="large">
            <el-descriptions-item label="开始时间">{{ contestInfo.start }}</el-descriptions-item>
            <el-descriptions-item :label="isHomework ? '截止时间' : '结束时间'">{{ contestInfo.end }}</el-descriptions-item>
            <el-descriptions-item :label="isHomework ? '作业时长' : '比赛时长'">{{ contestInfo.length }} min</el-descriptions-item>
            <el-descriptions-item :label="isHomework ? '类型' : '比赛类型'">{{ contestInfo.type }}</el-descriptions-item>
            <el-descriptions-item :label="isHomework ? '状态' : '比赛状态'">
              <el-tag style="margin-left: 10px;" :type="tagType[contestInfo.status]">
                {{ statusDisplay(contestInfo.status) }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item v-if="!isHomework" label="Rating">
              <el-tag :type="ratingStatusType(contestInfo.ratingStatus)">
                {{ ratingStatusText(contestInfo.ratingStatus, contestInfo.ratingEnabled) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item :label="isHomework ? '参与人数' : '参赛人数'">
              <router-link class="rlink" :to="'/contest/player/' + contestInfo.cid">
                <el-icon id="picon" size="13">
                  <UserFilled />
                </el-icon>
                × {{ contestInfo.playerCnt }}
              </router-link>
            </el-descriptions-item>
          </el-descriptions>
          <el-progress :text-inside="true" :stroke-width="16" :percentage="percentage" status="success"
            style="margin: 5px;" />
          <el-alert v-if="isHomework && contestInfo.auth && contestInfo.auth.inLateWindow" type="warning" show-icon
            :closable="false" :title="lateNoticeTitle" style="margin: 5px;" />
          <el-tabs v-model="activeName" class="demo-tabs" @tab-change="switchTab">
            <el-tab-pane name="main">
              <template #label>
                <el-icon style="margin: 4px;">
                  <Place />
                </el-icon>
                {{ isHomework ? '作业介绍' : '比赛介绍' }}
              </template>
              <v-md-preview :text="contestInfo.description" style="min-height: 600px;" />
            </el-tab-pane>
            <el-tab-pane name="problemList" v-if="joinAuth || viewAuth">
              <template #label>
                <el-icon style="margin: 4px;">
                  <Document />
                </el-icon>
                题目列表
              </template>
              <contestProblemList :ctype="contestInfo.type" ref="problemList" />
            </el-tab-pane>
            <el-tab-pane name="submission" v-if="joinAuth || viewAuth">
              <template #label>
                <el-icon style="margin: 4px;">
                  <DataAnalysis />
                </el-icon>
                提交记录
              </template>
              <contestSubmission ref="submission" :can-manage="canManage" />
            </el-tab-pane>
            <el-tab-pane name="rank" v-if="viewAuth">
              <template #label>
                <el-icon style="margin: 4px;">
                  <DataLine />
                </el-icon>
                排行榜
              </template>
              <contestRank ref="rank" :can-manage="canManage" />
            </el-tab-pane>
            <el-tab-pane name="team" v-if="teamModeOn && ($store.state.uid || canManage)">
              <template #label>
                <el-icon style="margin: 4px;">
                  <UserFilled />
                </el-icon>
                队伍
              </template>
              <teamPanel ref="team" :can-manage="canManage" @changed="all" />
            </el-tab-pane>
            <el-tab-pane name="hack" v-if="contestInfo.format === 'cf' && (hackAuth || viewHacksAuth)">
              <template #label>
                <el-icon style="margin: 4px;">
                  <Aim />
                </el-icon>
                Hack
              </template>
              <hackPanel ref="hack" :can-hack="hackAuth" />
            </el-tab-pane>
            <el-tab-pane name="manageC" v-if="canManage">
              <template #label>
                <el-icon style="margin: 4px;">
                  <SetUp />
                </el-icon>
                {{ isHomework ? '作业管理' : '比赛管理' }}
              </template>
              <el-row>
                <el-col :xs="24" :sm="24" :md="15" style="margin-bottom: 20px;">
                  <v-md-editor height="580px"
                    left-toolbar="undo redo clear | h bold italic strikethrough quote | ul ol table hr | link image code"
                    style="padding-right: 100px;" v-model="tmpInfo.description"></v-md-editor>
                </el-col>
                <el-col :xs="24" :sm="24" :md="9" style="padding-left: 30px;">
                  <el-form>
                    <el-form-item label="比赛标题">
                      <el-input v-model="tmpInfo.title" :disabled="tmpInfo.done" />
                    </el-form-item>
                    <el-form-item label="开始时间">
                      <div class="block">
                        <el-date-picker v-model="tmpInfo.start" type="datetime" :disabled="tmpInfo.done" />
                      </div>
                    </el-form-item>
                    <el-form-item label="结束时间">
                      <div class="block">
                        <el-date-picker v-model="tmpInfo.end" type="datetime" :disabled="tmpInfo.done" />
                      </div>
                    </el-form-item>
                    <el-form-item label="比赛类型">
                      <el-select v-model="tmpInfo.format" class="m-2" :disabled="tmpInfo.done"
                        @change="applyFormatPreset">
                        <el-option v-for="f in formatOptions" :key="f.id" :label="f.label" :value="f.id" />
                      </el-select>
                    </el-form-item>
                    <el-divider content-position="left" class="rules-divider">赛制与规则</el-divider>
                    <div class="rules-hint">默认值随赛制预设变化，可自由覆盖单项开关</div>
                    <el-form-item label="进行中可看排行榜">
                      <el-switch v-model="rules.liveScoreboard" size="large" active-text="开放" inactive-text="隐藏"
                        :disabled="tmpInfo.done" />
                    </el-form-item>
                    <el-form-item label="进行中可看评测结果">
                      <el-switch v-model="rules.liveResults" size="large" active-text="真实分数" inactive-text="全部隐藏"
                        :disabled="tmpInfo.done" />
                    </el-form-item>
                    <el-form-item v-if="tmpInfo.format !== 'homework'" label="封榜">
                      <el-switch v-model="rules.freezeEnabled" size="large" active-text="开启" inactive-text="关闭"
                        :disabled="tmpInfo.done" />
                      <el-input-number v-if="rules.freezeEnabled" v-model="rules.freezeMinutes" :min="1" :max="100000"
                        :disabled="tmpInfo.done" size="small" style="margin-left: 12px; width: 120px;" />
                      <span v-if="rules.freezeEnabled" class="rules-hint" style="margin: 0 0 0 8px;">
                        结束前分钟数
                      </span>
                    </el-form-item>
                    <el-form-item v-if="tmpInfo.format === 'homework'" label="允许迟交">
                      <el-switch v-model="rules.lateEnabled" size="large" active-text="开启" inactive-text="关闭"
                        :disabled="tmpInfo.done" />
                      <template v-if="rules.lateEnabled">
                        <el-input-number v-model="rules.lateWindowMinutes" :min="1" :max="1000000"
                          :disabled="tmpInfo.done" size="small" style="margin-left: 12px; width: 120px;" />
                        <span class="rules-hint" style="margin: 0 0 0 8px;">截止后分钟数</span>
                        <el-input-number v-model="rules.lateScoreRatio" :min="0" :max="1" :step="0.1"
                          :disabled="tmpInfo.done" size="small" style="margin-left: 12px; width: 100px;" />
                        <span class="rules-hint" style="margin: 0 0 0 8px;">得分系数</span>
                      </template>
                    </el-form-item>
                    <el-form-item label="组队参赛">
                      <el-switch v-model="rules.teamEnabled" size="large" active-text="开启" inactive-text="关闭"
                        :disabled="tmpInfo.done" />
                      <template v-if="rules.teamEnabled">
                        <el-input-number v-model="rules.teamMaxSize" :min="1" :max="20" :disabled="tmpInfo.done"
                          size="small" style="margin-left: 12px; width: 110px;" />
                        <span class="rules-hint" style="margin: 0 0 0 8px;">每队上限</span>
                        <el-checkbox v-model="rules.teamSelfForm" :disabled="tmpInfo.done"
                          style="margin-left: 12px;">允许自由组队</el-checkbox>
                      </template>
                    </el-form-item>
                    <template v-if="tmpInfo.format === 'cf'">
                      <el-form-item label="Pretest 终测">
                        <el-switch v-model="rules.pretestEnabled" size="large" active-text="开启" inactive-text="关闭"
                          :disabled="tmpInfo.done" />
                        <span class="rules-hint" style="margin: 0 0 0 8px;">赛中只评 pretest，终测统一重评</span>
                      </el-form-item>
                      <el-form-item label="允许 Hack">
                        <el-switch v-model="rules.hackEnabled" size="large" active-text="开启" inactive-text="关闭"
                          :disabled="tmpInfo.done" />
                        <span class="rules-hint" style="margin: 0 0 0 8px;">需要题目配 std/validator 资产</span>
                      </el-form-item>
                    </template>
                    <el-divider class="rules-divider" />
                    <el-form-item label="是否公开">
                      <el-switch v-model="tmpInfo.isPublic" size="large" active-text="公开" inactive-text="私有"
                        :disabled="tmpInfo.done" />
                    </el-form-item>
                    <el-form-item v-if="tmpInfo.format !== 'homework'" label="参与 Rating">
                      <el-switch v-model="tmpInfo.ratingEnabled" size="large" active-text="Rated" inactive-text="Unrated"
                        :disabled="tmpInfo.done" />
                    </el-form-item>
                    <el-form-item label="支持语言">
                      <el-select v-model="avalangList" multiple collapse-tags :max-collapse-tags="3" placeholder="支持语言"
                        :disabled="tmpInfo.done">
                        <el-option v-for="l in this.$store.state.langList" :key="l.id" :label="l.des" :value="l.id" />
                      </el-select>
                    </el-form-item>
                    <el-form-item class="contest-action-row">
                      <el-button type="danger" @click="updateContest" :disabled="tmpInfo.done">更新比赛</el-button>
                      <el-button type="primary" :disabled="tmpInfo.done"
                        @click="resetTmpInfo">重新设置</el-button>
                      <el-button type="info" :disabled="!contestInfo.ratingEnabled" :loading="ratingPreviewLoading"
                        @click="previewContestRating">
                        预览 Rating
                      </el-button>
                      <el-button type="success" plain :loading="healthLoading" @click="checkContest">
                        检查比赛
                      </el-button>
                      <el-popconfirm v-if="contestInfo.format === 'cf'" confirm-button-text="确认" cancel-button-text="取消"
                        title="确认启动终测? pretest 通过的提交将按全量数据+hack 数据重测" @confirm="startSystest">
                        <template #reference>
                          <el-button type="warning" :disabled="contestInfo.phase > 0">
                            {{ contestInfo.phase === 2 ? '终测已完成' : contestInfo.phase === 1 ? '终测进行中' : '启动终测' }}
                          </el-button>
                        </template>
                      </el-popconfirm>
                      <el-popconfirm confirm-button-text="确认" cancel-button-text="取消"
                        :title="rejudgeContestConfirmTitle"
                        @confirm="reJudgeContest">
                        <template #reference>
                          <el-button type="warning">
                            重测比赛
                          </el-button>
                        </template>
                      </el-popconfirm>
                      <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认结束比赛?(结束后无法再修改比赛)"
                        @confirm="closeContest">
                        <template #reference>
                          <el-button type="danger" :disabled="tmpInfo.done">
                            结束比赛
                          </el-button>
                        </template>
                      </el-popconfirm>
                      <el-popconfirm confirm-button-text="确认" cancel-button-text="取消"
                        title="确认重新结算本场 Rating? 若已有后续结算将被拒绝" @confirm="recalculateContestRating">
                        <template #reference>
                          <el-button v-if="tmpInfo.done && tmpInfo.ratingEnabled" type="warning">
                            重算 Rating
                          </el-button>
                        </template>
                      </el-popconfirm>
                    </el-form-item>
                  </el-form>
                </el-col>
              </el-row>
            </el-tab-pane>
            <el-tab-pane name="manageP" v-if="canManage">
              <template #label>
                <el-icon style="margin: 4px;">
                  <SetUp />
                </el-icon>
                题目管理
              </template>
              <problemManage ref="manageP" />
            </el-tab-pane>
            <el-tab-pane name="collaborators" v-if="canManage">
              <template #label>
                <el-icon style="margin: 4px;">
                  <Lock />
                </el-icon>
                协作者
              </template>
              <CollaboratorPanel
                resource-type="contest"
                :resource-id="parseInt(cid)"
                :visible="canManage"
                :can-edit="isOwner"
              />
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </el-col>
    </el-row>
    <el-dialog v-model="healthVisible" title="比赛体检" width="760px" destroy-on-close>
      <div class="health-summary">
        <el-tag type="danger" v-if="healthSummary.error">错误 {{ healthSummary.error }}</el-tag>
        <el-tag type="warning" v-if="healthSummary.warn">警告 {{ healthSummary.warn }}</el-tag>
        <el-tag type="success">正常 {{ healthSummary.ok || 0 }}</el-tag>
        <span v-if="!healthSummary.error" class="health-pass">未发现阻塞问题，可以开赛</span>
      </div>
      <el-table :data="healthChecks" max-height="520" v-loading="healthLoading">
        <el-table-column label="级别" width="90">
          <template #default="scope">
            <el-tag :type="{ error: 'danger', warn: 'warning', ok: 'success' }[scope.row.level] || 'info'" effect="dark">
              {{ { error: '错误', warn: '警告', ok: '正常' }[scope.row.level] || scope.row.level }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="检查项" min-width="220" />
        <el-table-column prop="detail" label="说明" min-width="260" show-overflow-tooltip />
      </el-table>
    </el-dialog>
    <el-dialog v-model="ratingPreviewVisible" title="Rating 预览" width="760px" destroy-on-close>
      <div class="rating-preview-meta">
        <el-tag :type="ratingPreviewTagType()">
          {{ ratingPreviewTagText() }}
        </el-tag>
        <span v-if="ratingPreviewMeta.unrated">该比赛未参与 Rating</span>
        <span v-else-if="ratingPreviewMeta.sampleInsufficient">样本不足，不产生 Rating</span>
        <span v-else>共 {{ ratingPreviewMeta.count || ratingPreviewRows.length }} 名选手</span>
      </div>
      <el-alert v-if="ratingPreviewMeta.hasMoreChanges" class="rating-preview-alert" type="info" show-icon
        :closable="false" :title="ratingPreviewLimitText()" />
      <el-alert v-if="ratingPreviewMeta.blocked" class="rating-preview-alert" type="warning" show-icon
        :closable="false" :title="ratingPreviewConflictText()" />
      <el-alert v-if="ratingPreviewMeta.pendingJudgement" class="rating-preview-alert" type="warning" show-icon
        :closable="false" :title="ratingPreviewPendingText()" />
      <el-alert v-if="ratingPreviewMeta.sampleInsufficient" class="rating-preview-alert" type="info" show-icon
        :closable="false" :title="ratingPreviewSampleInsufficientText()" />
      <el-alert v-if="ratingPreviewMeta.drifted" class="rating-preview-alert" type="warning" show-icon
        :closable="false" :title="ratingPreviewDriftText()" :description="ratingPreviewDriftDetailText()" />
      <el-table :data="ratingPreviewRows" v-loading="ratingPreviewLoading" max-height="520" empty-text="暂无可评级选手">
        <el-table-column prop="rank" label="排名" width="80" />
        <el-table-column label="用户" min-width="150">
          <template #default="scope">
            <div class="rating-user">{{ scope.row.username }}</div>
            <div class="rating-uid">UID {{ scope.row.uid }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="totalScore" label="分数" width="90" />
        <el-table-column prop="usedTime" label="用时" width="90" />
        <el-table-column label="Rating" min-width="190">
          <template #default="scope">
            <div class="rating-cell">
              <span class="rating-value" :style="{ color: ratingTier(scope.row.newRating).color }">
                {{ scope.row.newRating }}
              </span>
              <el-tag size="small" effect="plain"
                :style="{
                  color: ratingTier(scope.row.newRating).color,
                  borderColor: ratingTier(scope.row.newRating).color,
                  backgroundColor: ratingTier(scope.row.newRating).bg
                }">
                {{ ratingTier(scope.row.newRating).label }}
              </el-tag>
            </div>
            <div class="rating-old">{{ scope.row.oldRating }} -> {{ scope.row.newRating }}</div>
          </template>
        </el-table-column>
        <el-table-column label="变化" width="90">
          <template #default="scope">
            <el-tag :type="ratingDeltaType(scope.row.delta)" effect="dark">
              {{ ratingDeltaText(scope.row.delta) }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script>
import axios from 'axios';
import { getRatingTier } from '@/assets/common.js';
import contestSubmission from './components/contestSubmission.vue'
import contestRank from './components/contestRank.vue'
import contestProblemList from './components/contestProblemList.vue'
import problemManage from './components/problemManage.vue'
import hackPanel from './components/hackPanel.vue'
import teamPanel from './components/teamPanel.vue'
import CollaboratorPanel from '@/components/permission/CollaboratorPanel.vue'

export default {
  name: "contestMain",
  components: {
    contestSubmission,
    contestRank,
    contestProblemList,
    problemManage,
    hackPanel,
    teamPanel,
    CollaboratorPanel,
  },
  computed: {
    // Mirrors server/api/contest/contest.js#canManageContest. The server-computed
    // contestInfo.auth.manage is authoritative; this is just the first-paint
    // guess. The new model: (host AND contest.manage.self) OR contest.manage.any.
    canManage() {
      if (this.contestInfo && this.contestInfo.auth && this.contestInfo.auth.manage !== undefined)
        return this.contestInfo.auth.manage;
      const isHost = this.contestInfo && this.contestInfo.host === this.$store.state.uid;
      return (isHost && this.$can('contest.manage.self')) || this.$can('contest.manage.any');
    },
    // Only the contest host (or a global grantor) can add/remove collaborators.
    // A user with contest.manage.any scoped to this contest is just a
    // collaborator and gets read-only access to the collaborator list.
    isOwner() {
      return (this.contestInfo && this.contestInfo.host === this.$store.state.uid)
        || this.$can('user.role.admin');
    },
    teamModeOn() {
      return !!(this.contestInfo.auth && this.contestInfo.auth.teamMode);
    },
    isHomework() {
      return this.contestInfo.format === 'homework';
    },
    lateNoticeTitle() {
      const late = this.contestInfo.config && this.contestInfo.config.late || {};
      const percent = Math.round((Number(late.scoreRatio) || 0) * 100);
      return `已过截止时间，迟交窗口开放中：此后提交的得分按 ${percent}% 计`;
    },
    rejudgeContestConfirmTitle() {
      if (this.tmpInfo && this.tmpInfo.done) {
        return '确认重测该场已结束比赛所有提交? Rating 会等待评测完成后再重算';
      }
      return '确认重测该场比赛所有提交?';
    },
  },
  data() {
    return {
      cid: 0,
      contestInfo: {},
      tmpInfo: {},
      activeName: '',
      percentage: 0,
      joinAuth: false,
      viewAuth: false,
      hackAuth: false,
      viewHacksAuth: false,
      healthVisible: false,
      healthLoading: false,
      healthChecks: [],
      healthSummary: {},
      tagType: {
        '未开始': '',
        '正在进行': 'danger',
        '等待测评': 'success',
        '已结束': 'info',
      },
      needUpdate: ['problemList', 'submission', 'rank', 'manageP', 'hack'],
      avalangList: [],
      formatOptions: [
        { id: 'oi', label: 'OI' },
        { id: 'ioi', label: 'IOI' },
        { id: 'acm', label: 'ACM' },
        { id: 'cf', label: 'Codeforces' },
        { id: 'homework', label: '作业' },
      ],
      // 赛制预设默认（与 server/api/contest/formats.js 保持一致）
      formatPresets: {
        oi: { liveScoreboard: false, liveResults: false, freezeEnabled: false, freezeMinutes: 60, pretestEnabled: false, hackEnabled: false, teamEnabled: false, teamMaxSize: 3, teamSelfForm: true, lateEnabled: false, lateWindowMinutes: 1440, lateScoreRatio: 0.5 },
        ioi: { liveScoreboard: true, liveResults: true, freezeEnabled: false, freezeMinutes: 60, pretestEnabled: false, hackEnabled: false, teamEnabled: false, teamMaxSize: 3, teamSelfForm: true, lateEnabled: false, lateWindowMinutes: 1440, lateScoreRatio: 0.5 },
        acm: { liveScoreboard: true, liveResults: true, freezeEnabled: true, freezeMinutes: 60, pretestEnabled: false, hackEnabled: false, teamEnabled: false, teamMaxSize: 3, teamSelfForm: true, lateEnabled: false, lateWindowMinutes: 1440, lateScoreRatio: 0.5 },
        cf: { liveScoreboard: true, liveResults: true, freezeEnabled: false, freezeMinutes: 60, pretestEnabled: true, hackEnabled: true, teamEnabled: false, teamMaxSize: 3, teamSelfForm: true, lateEnabled: false, lateWindowMinutes: 1440, lateScoreRatio: 0.5 },
        homework: { liveScoreboard: true, liveResults: true, freezeEnabled: false, freezeMinutes: 60, pretestEnabled: false, hackEnabled: false, teamEnabled: false, teamMaxSize: 3, teamSelfForm: true, lateEnabled: true, lateWindowMinutes: 1440, lateScoreRatio: 0.5 },
      },
      rules: { liveScoreboard: false, liveResults: false, freezeEnabled: false, freezeMinutes: 60, pretestEnabled: false, hackEnabled: false, teamEnabled: false, teamMaxSize: 3, teamSelfForm: true, lateEnabled: false, lateWindowMinutes: 1440, lateScoreRatio: 0.5 },
      ratingPreviewVisible: false,
      ratingPreviewLoading: false,
      ratingPreviewRows: [],
      ratingPreviewMeta: {},
      ratingPreviewLimit: 100,
      timer: null,
    }
  },
  methods: {
    apiErrorMessage(err, fallback) {
      const detail = err && err.response && err.response.data && err.response.data.message
        ? err.response.data.message
        : (err && err.message ? err.message : '');
      return detail ? `${fallback}${detail}` : fallback;
    },
    ratingTier(rating) {
      return getRatingTier(rating);
    },
    // 作业语境的状态文案（等待测评 = 已过 deadline，迟交窗口可能仍开放）
    statusDisplay(status) {
      if (!this.isHomework) return status;
      return { '正在进行': '进行中', '等待测评': '已截止' }[status] || status;
    },
    ratingDeltaText(delta) {
      const value = Number(delta || 0);
      return value > 0 ? `+${value}` : String(value);
    },
    ratingDeltaType(delta) {
      const value = Number(delta || 0);
      if (value > 0) return 'success';
      if (value < 0) return 'danger';
      return 'info';
    },
    ratingSyncTail(rating) {
      if (!rating) return '';
      if (rating.ratingCacheMismatchAfter) return `，仍有 ${rating.ratingCacheMismatchAfter} 个缓存差异`;
      if (rating.syncedUserCount) return `，同步 ${rating.syncedUserCount} 个缓存差异`;
      return '';
    },
    ratingStorageTail(rating) {
      if (!rating) return '';
      const parts = [];
      if (rating.primaryKeyAdded || rating.uniqueKeyAdded) {
        parts.push('已恢复唯一约束');
      } else if (rating.ratingUniqueConstraintReady) {
        parts.push('唯一约束正常');
      }
      if (rating.uidIndexAdded || rating.cidRankIndexAdded) {
        parts.push('已恢复辅助索引');
      } else if (rating.ratingAuxiliaryIndexesReady) {
        parts.push('辅助索引正常');
      }
      return parts.length ? `，${parts.join('，')}` : '';
    },
    ratingInvalidLastSubmissionTail(rating) {
      const count = Number(rating && rating.invalidLastSubmissionCount || 0);
      return count ? `，另有 ${count} 条无效最后提交未计入` : '';
    },
    ratingPendingJudgementDetail(rating) {
      const userCount = Number(rating && rating.pendingJudgementUserCount || 0);
      const problemCount = Number(rating && rating.pendingJudgementProblemCount || 0);
      const parts = [];
      if (userCount) parts.push(`${userCount} 名用户`);
      if (problemCount) parts.push(`${problemCount} 题`);
      return parts.length ? `（${parts.join(' / ')}）` : '';
    },
    ratingStatusText(status, ratingEnabled) {
      if (status && status.label) return status.label;
      return ratingEnabled ? 'Rated' : 'Unrated';
    },
    ratingStatusType(status) {
      return status && status.type ? status.type : 'info';
    },
    ratingPreviewTagType() {
      if (this.ratingPreviewMeta.unrated) return 'info';
      if (this.ratingPreviewMeta.sampleInsufficient) return 'info';
      if (this.ratingPreviewMeta.pendingJudgement) return 'warning';
      if (this.ratingPreviewMeta.blocked) return 'danger';
      if (this.ratingPreviewMeta.drifted) return 'danger';
      if (this.ratingPreviewMeta.settled) return 'warning';
      return 'success';
    },
    ratingPreviewTagText() {
      if (this.ratingPreviewMeta.unrated) return 'Unrated';
      if (this.ratingPreviewMeta.sampleInsufficient) return '样本不足';
      if (this.ratingPreviewMeta.pendingJudgement) return '等待测评';
      if (this.ratingPreviewMeta.blocked) return '需重建';
      if (this.ratingPreviewMeta.drifted) return '需重算';
      if (this.ratingPreviewMeta.settled) return '已结算';
      return '预估';
    },
    ratingPreviewConflictText() {
      const conflict = this.ratingPreviewMeta.conflict || {};
      const title = conflict.title ? `（${conflict.title}）` : '';
      return `已有后续比赛 Rating${title}，直接结算会破坏时间线，请按时间顺序全量重建`;
    },
    ratingPreviewPendingText() {
      return `还有 ${this.ratingPreviewMeta.pendingJudgementCount || 0} 个最后提交尚未完成评测${this.ratingPendingJudgementDetail(this.ratingPreviewMeta)}${this.ratingInvalidLastSubmissionTail(this.ratingPreviewMeta)}，完成后才能结算 Rating`;
    },
    ratingPreviewSampleInsufficientText() {
      return `提交人数 ${this.ratingPreviewMeta.submittedUserCount || 0}/${this.ratingPreviewMeta.minParticipantCount || 2}${this.ratingInvalidLastSubmissionTail(this.ratingPreviewMeta)}，本场不会产生 Rating`;
    },
    ratingPreviewDriftText() {
      return `当前预览与已保存 Rating 不一致，涉及 ${this.ratingPreviewMeta.driftDiffUserCount || 0} 名选手`;
    },
    ratingPreviewLimitText() {
      const returned = this.ratingPreviewMeta.returnedCount || this.ratingPreviewRows.length || 0;
      const omitted = this.ratingPreviewMeta.omittedCount || 0;
      const limit = this.ratingPreviewMeta.detailLimit || this.ratingPreviewLimit || returned;
      return `当前只显示前 ${returned} 名 Rating 变化（上限 ${limit}），另有 ${omitted} 名未展开`;
    },
    ratingPreviewDriftDetailText() {
      const mismatch = this.ratingPreviewMeta.driftFirstMismatch || {};
      if (!mismatch.field) return '等待重算确认';
      const fields = {
        rank: '排名',
        totalScore: '分数',
        usedTime: '用时',
        oldRating: '旧分',
        newRating: '新分',
        delta: '变化',
        algorithm: '算法',
        missingRow: '缺少选手',
        extraRow: '多余选手',
      };
      const name = mismatch.username || (mismatch.uid ? `UID ${mismatch.uid}` : '选手');
      const valueText = mismatch.oldValue !== undefined && mismatch.newValue !== undefined
        ? `（已保存 ${mismatch.oldValue} / 当前 ${mismatch.newValue}）`
        : '';
      return `${name}：${fields[mismatch.field] || mismatch.field}${valueText}`;
    },
    previewContestRating() {
      this.ratingPreviewVisible = true;
      this.ratingPreviewLoading = true;
      axios.post('/api/contest/previewRating', {
        cid: this.cid,
        detailLimit: this.ratingPreviewLimit,
      }).then(res => {
        if (res.status === 200) {
          const rating = res.data.rating || {};
          this.ratingPreviewRows = rating.data || [];
          this.ratingPreviewMeta = rating;
        } else {
          this.$message.error('预览失败' + res.data.message);
        }
      }).catch(err => {
        this.$message.error(this.apiErrorMessage(err, '预览失败'));
      }).finally(() => {
        this.ratingPreviewLoading = false;
      });
    },
    resetTmpInfo() {
      this.tmpInfo = JSON.parse(JSON.stringify(this.contestInfo));
      this.initRulesFromConfig(this.contestInfo.config);
    },
    // 切换赛制：规则开关重置为该预设默认值
    applyFormatPreset(format) {
      const preset = this.formatPresets[format];
      if (preset) this.rules = { ...preset };
      // 作业强制 unrated（服务端也会强制）
      if (format === 'homework') this.tmpInfo.ratingEnabled = false;
    },
    // 从生效配置（服务端 resolveConfig 结果）初始化规则开关
    initRulesFromConfig(config) {
      const preset = this.formatPresets[this.contestInfo.format] || this.formatPresets.oi;
      const freeze = config && config.scoreboard && config.scoreboard.freeze;
      const cf = config && config.cf;
      const late = config && config.late;
      this.rules = {
        liveScoreboard: config && config.scoreboard
          ? config.scoreboard.duringContest === 'full' : preset.liveScoreboard,
        liveResults: config && config.submission
          ? config.submission.resultVisibility === 'full' : preset.liveResults,
        freezeEnabled: freeze ? !!freeze.enabled : preset.freezeEnabled,
        freezeMinutes: freeze && freeze.offsetMinutes != null ? freeze.offsetMinutes : preset.freezeMinutes,
        pretestEnabled: cf && cf.pretestEnabled !== undefined ? !!cf.pretestEnabled : preset.pretestEnabled,
        hackEnabled: cf && cf.hackEnabled !== undefined ? !!cf.hackEnabled : preset.hackEnabled,
        teamEnabled: config && config.team && config.team.enabled !== undefined ? !!config.team.enabled : preset.teamEnabled,
        teamMaxSize: config && config.team && config.team.maxSize != null ? config.team.maxSize : preset.teamMaxSize,
        teamSelfForm: config && config.team && config.team.allowSelfForm !== undefined ? !!config.team.allowSelfForm : preset.teamSelfForm,
        lateEnabled: late && late.enabled !== undefined ? !!late.enabled : preset.lateEnabled,
        lateWindowMinutes: late && late.windowMinutes != null ? late.windowMinutes : preset.lateWindowMinutes,
        lateScoreRatio: late && late.scoreRatio != null ? late.scoreRatio : preset.lateScoreRatio,
      };
    },
    // 只保存与预设不同的键；与预设完全一致则清空覆盖（config=null）
    buildConfigPatch() {
      const preset = this.formatPresets[this.tmpInfo.format] || this.formatPresets.oi;
      const patch = {};
      if (this.rules.liveScoreboard !== preset.liveScoreboard) {
        patch.scoreboard = { duringContest: this.rules.liveScoreboard ? 'full' : 'none' };
      }
      const freezePatch = {};
      if (this.rules.freezeEnabled !== preset.freezeEnabled) freezePatch.enabled = this.rules.freezeEnabled;
      if (this.rules.freezeEnabled && this.rules.freezeMinutes !== preset.freezeMinutes) {
        freezePatch.offsetMinutes = this.rules.freezeMinutes;
      }
      // 保留已有的解榜状态（reveal 由排行榜页的解榜按钮单独写入）
      const prevFreeze = this.contestInfo.configPatch && this.contestInfo.configPatch.scoreboard
        && this.contestInfo.configPatch.scoreboard.freeze;
      if (prevFreeze && prevFreeze.revealed) freezePatch.revealed = true;
      if (Object.keys(freezePatch).length) {
        patch.scoreboard = { ...(patch.scoreboard || {}), freeze: freezePatch };
      }
      if (this.rules.liveResults !== preset.liveResults) {
        patch.submission = { resultVisibility: this.rules.liveResults ? 'full' : 'none' };
      }
      if (this.tmpInfo.format === 'cf') {
        const cfPatch = {};
        if (this.rules.pretestEnabled !== preset.pretestEnabled) cfPatch.pretestEnabled = this.rules.pretestEnabled;
        if (this.rules.hackEnabled !== preset.hackEnabled) cfPatch.hackEnabled = this.rules.hackEnabled;
        if (Object.keys(cfPatch).length) patch.cf = cfPatch;
      }
      if (this.tmpInfo.format === 'homework') {
        const latePatch = {};
        if (this.rules.lateEnabled !== preset.lateEnabled) latePatch.enabled = this.rules.lateEnabled;
        if (this.rules.lateEnabled && this.rules.lateWindowMinutes !== preset.lateWindowMinutes) {
          latePatch.windowMinutes = this.rules.lateWindowMinutes;
        }
        if (this.rules.lateEnabled && this.rules.lateScoreRatio !== preset.lateScoreRatio) {
          latePatch.scoreRatio = this.rules.lateScoreRatio;
        }
        if (Object.keys(latePatch).length) patch.late = latePatch;
      }
      const teamPatch = {};
      if (this.rules.teamEnabled !== preset.teamEnabled) teamPatch.enabled = this.rules.teamEnabled;
      if (this.rules.teamEnabled && this.rules.teamMaxSize !== preset.teamMaxSize) teamPatch.maxSize = this.rules.teamMaxSize;
      if (this.rules.teamEnabled && this.rules.teamSelfForm !== preset.teamSelfForm) teamPatch.allowSelfForm = this.rules.teamSelfForm;
      if (Object.keys(teamPatch).length) patch.team = teamPatch;
      return Object.keys(patch).length ? patch : null;
    },
    checkContest() {
      this.healthVisible = true;
      this.healthLoading = true;
      axios.post('/api/contest/checkContest', { cid: this.cid }).then(res => {
        this.healthChecks = res.data.data.checks || [];
        this.healthSummary = res.data.data.summary || {};
      }).catch(err => {
        this.$message.error(this.apiErrorMessage(err, '体检失败'));
      }).finally(() => { this.healthLoading = false; });
    },
    startSystest() {
      axios.post('/api/contest/startSystest', { cid: this.cid }).then(res => {
        this.$message.success(`终测已启动，重测 ${res.data.total} 个提交`);
        this.all();
      }).catch(err => {
        this.$message.error(this.apiErrorMessage(err, '终测启动失败'));
      });
    },
    updateContest() {
      if (!this.avalangList.length) {
        this.$message.error('请选择至少一个支持语言');
        return;
      }
      this.tmpInfo.lang = 0;
      for (let i of this.avalangList)
        this.tmpInfo.lang |= (1 << i);
      this.tmpInfo.length = (new Date(this.tmpInfo.end).getTime() - new Date(this.tmpInfo.start).getTime()) / 1000 / 60;
      if (this.tmpInfo.length < 0) {
        this.$message.error('比赛时长错误');
        return;
      }
      this.tmpInfo.config = this.buildConfigPatch();
      axios.post('/api/contest/updateContestInfo', {
        cid: this.cid,
        info: this.tmpInfo
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('修改成功');
        } else {
          this.$message.error('修改失败' + res.data.message);
        }
        this.all();
      }).catch(err => {
        this.$message.error(this.apiErrorMessage(err, '修改失败'));
      });
    },
    frushPercentage() {
      this.percentage = parseInt((new Date().getTime() -
        new Date(this.contestInfo.start).getTime()) / 10 / 60 / this.contestInfo.length);
      if (this.percentage < 0) this.percentage = 0;
      else if (this.percentage > 100) this.percentage = 100;
    },
    all() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      axios.post('/api/contest/getContestInfo', { cid: this.cid }).then(res => {
        if (res.status === 200) {
          this.contestInfo = res.data.data;
          this.avalangList = [];
          for (let l in this.$store.state.langList) {
            let lid = this.$store.state.langList[l].id;
            if ((1 << lid) & this.contestInfo.lang)
              this.avalangList.push(lid);
          }
          this.contestInfo.isPublic = !!res.data.data.isPublic;
          this.contestInfo.done = !!res.data.data.done;
          this.contestInfo.ratingEnabled = !!res.data.data.ratingEnabled;
          this.joinAuth = res.data.data.auth.join;
          this.viewAuth = res.data.data.auth.view;
          this.hackAuth = !!res.data.data.auth.hack;
          this.viewHacksAuth = !!res.data.data.auth.viewHacks;
          this.tmpInfo = JSON.parse(JSON.stringify(this.contestInfo));
          this.initRulesFromConfig(this.contestInfo.config);
          this.frushPercentage();
          this.timer = setInterval(() => {
            this.frushPercentage();
          }, 60000);
          document.title = (this.isHomework ? "作业 — " : "比赛 — ") + this.contestInfo.title;
        }
        else {
          this.$message.error(res.data.message);
          this.contestInfo.description = "# 您的权限不足";
        }
      }).catch(err => {
        this.$message.error(this.apiErrorMessage(err, '加载比赛失败'));
        this.contestInfo.description = "# 加载比赛失败";
      });
    },
    switchTab(tab) {
      let url = location.pathname;
      if (tab !== 'main')
        url += ('?tab=' + tab);
      history.state.current = url;
      history.replaceState(history.state, null, url);
      if (this.needUpdate.includes(tab)) {
        this.$nextTick(() => { this.$refs[tab].all(); });
      }
    },
    closeContest() {
      axios.post('/api/contest/closeContest', {
        cid: this.cid,
      }).then(res => {
        if (res.status === 200) {
          const rating = res.data && res.data.rating;
          const syncTail = this.ratingSyncTail(rating);
          const storageTail = this.ratingStorageTail(rating);
          if (rating && rating.applied) {
            this.$message.success(`操作成功，已结算 ${rating.count || 0} 名选手 Rating${syncTail}${storageTail}`);
          } else if (rating && rating.locked) {
            this.$message.warning('比赛已结束，但 Rating 正在结算或重建，请稍后在管理页结算本场');
          } else if (rating && rating.pendingJudgement) {
            this.$message.warning(`比赛已结束，但还有 ${rating.pendingJudgementCount || 0} 个最后提交未完成评测${this.ratingPendingJudgementDetail(rating)}${this.ratingInvalidLastSubmissionTail(rating)}，暂未结算 Rating`);
          } else if (rating && rating.sampleInsufficient) {
            this.$message.success(`操作成功，样本不足未产生 Rating（${rating.submittedUserCount || 0}/${rating.minParticipantCount || 2}${this.ratingInvalidLastSubmissionTail(rating)}）${syncTail}${storageTail}`);
          } else if (rating && rating.blocked) {
            const title = rating.conflict && rating.conflict.title ? `（${rating.conflict.title}）` : '';
            this.$message.warning(`比赛已结束，但已有后续比赛 Rating${title}，请按时间顺序全量重建`);
          } else if (rating && rating.unrated) {
            this.$message.success('操作成功，该比赛未参与 Rating');
          } else {
            this.$message.success('操作成功');
          }
        } else {
          this.$message.error('操作失败' + res.data.message);
        }
        this.all();
      }).catch(err => {
        this.$message.error(this.apiErrorMessage(err, '结束比赛失败'));
      });
    },
    recalculateContestRating() {
      axios.post('/api/contest/recalculateContestRating', {
        cid: this.cid,
      }).then(res => {
        if (res.status === 200) {
          const rating = res.data && res.data.rating;
          const count = rating ? rating.count || 0 : 0;
          const syncTail = this.ratingSyncTail(rating);
          const storageTail = this.ratingStorageTail(rating);
          if (rating && rating.sampleInsufficient) {
            this.$message.success(`样本不足，本场未产生 Rating（${rating.submittedUserCount || 0}/${rating.minParticipantCount || 2}${this.ratingInvalidLastSubmissionTail(rating)}）${syncTail}${storageTail}`);
          } else {
            this.$message.success(`已重新结算 ${count} 名选手 Rating${syncTail}${storageTail}`);
          }
          if (this.$refs.rank) this.$refs.rank.all();
        } else {
          this.$message.error('重算失败' + res.data.message);
        }
        this.all();
      }).catch(err => {
        this.$message.error(this.apiErrorMessage(err, '重算失败'));
      });
    },
    regContest() {
      axios.post('/api/contest/contestReg', {
        cid: this.cid,
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('报名成功');
        } else {
          this.$message.error('报名失败' + res.data.message);
        }
        this.all();
      }).catch(err => {
        this.$message.error(this.apiErrorMessage(err, '报名失败'));
      });
    },
    reJudgeContest() {
      axios.post('/api/judge/reJudgeContest', {
        cid: this.cid,
      }).then(res => {
        if (res.status === 200) {
          const total = res.data && res.data.total;
          const countText = total != null ? `${total} 条提交` : '提交';
          const ratingText = this.tmpInfo && this.tmpInfo.done ? '，评测完成后请重算 Rating' : '';
          this.$message.success(`已加入重测队列：${countText}${ratingText}`);
          this.activeName = 'submission';
          this.$router.push({
            path: '/contest/' + this.cid,
            query: {
              tab: 'submission'
            }
          });
          this.$nextTick(() => {
            if (this.$refs.submission && typeof this.$refs.submission.all === 'function') {
              this.$refs.submission.all();
            }
            if (this.$refs.rank && typeof this.$refs.rank.all === 'function') {
              this.$refs.rank.all();
            }
          });
          this.all();
        } else {
          this.$message.error('重测失败' + res.data.message);
        }
      }).catch(err => {
        this.$message.error(this.apiErrorMessage(err, '重测失败'));
      });
    }
  },
  mounted() {
    this.cid = this.$route.params.cid;
    this.activeName = this.$route.query.tab || 'main';
    this.all();
  },
  beforeUnmount() {
    clearInterval(this.timer);
  }
}
</script>

<style scoped>
.box-card {
  margin: 10px;
  text-align: left;
}

.title {
  text-align: center;
  margin: 0;
  font-size: 25px;
}

.demo-tabs {
  margin: 10px;
}

#picon {
  vertical-align: -2px;
}

.el-form-item {
  height: 35px;
}

.contest-action-row {
  height: auto;
}

.rules-divider {
  margin: 12px 0;
}

.rules-hint {
  color: #909399;
  font-size: 12px;
  margin-bottom: 8px;
}

.health-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.health-pass {
  color: #67c23a;
  font-size: 13px;
}

:deep(.contest-action-row .el-form-item__content) {
  gap: 10px;
}

.rating-preview-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  color: #606266;
}

.rating-preview-alert {
  margin-bottom: 12px;
}

.rating-user {
  color: #303133;
  font-weight: 600;
}

.rating-uid,
.rating-old {
  color: #909399;
  font-size: 12px;
}

.rating-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rating-value {
  font-size: 16px;
  font-weight: 800;
}
</style>
