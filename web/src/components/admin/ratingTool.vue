<template>
  <div class="rating-page">
    <header class="page-head">
      <div>
        <div class="eyebrow">ADMIN</div>
        <h1>Rating 管理</h1>
        <div class="policy-line" v-if="policy.algorithm">
          <el-tag size="small" effect="plain">{{ policy.algorithm }}</el-tag>
          <span>初始 {{ policy.defaultRating || 0 }}</span>
          <span>K {{ policy.kFactor || 0 }}</span>
          <span>Δ {{ policy.maxDelta || 0 }}</span>
          <span>至少 {{ policy.minParticipants || 0 }} 人</span>
        </div>
      </div>
      <div class="head-actions">
        <div class="limit-control">
          <span>显示</span>
          <el-input-number v-model="listLimit" size="small" :min="10" :max="100" :step="10"
            controls-position="right" @change="fetchStats" />
        </div>
        <el-button plain icon="Refresh" :loading="loading" @click="fetchStats">刷新</el-button>
        <el-button plain icon="DataLine" :loading="syncing"
          :disabled="!stats.ratingCacheMismatchCount" @click="syncRatingCache">
          同步缓存
        </el-button>
        <el-button type="warning" plain icon="Tickets" :loading="cleaning"
          :disabled="cleanupDisabled" @click="cleanupStaleRatings">
          清理异常
        </el-button>
        <el-button plain icon="Tickets" :loading="previewingRebuild" @click="previewRebuildRatings">
          预检重建
        </el-button>
        <el-button type="danger" icon="Warning" :loading="rebuilding" @click="rebuildRatings">
          全量重建
        </el-button>
      </div>
    </header>

    <section class="metrics-grid">
      <div class="metric">
        <div class="metric-label">已结束比赛</div>
        <div class="metric-value">{{ stats.doneContestCount || 0 }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">参与 Rating</div>
        <div class="metric-value">{{ stats.ratingEnabledContestCount || 0 }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">已结算比赛</div>
        <div class="metric-value">{{ stats.ratedContestCount || 0 }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Rating 记录</div>
        <div class="metric-value">{{ stats.ratingRowCount || 0 }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">已评级用户</div>
        <div class="metric-value">{{ stats.activeRatedUserCount == null ? (stats.ratedUserCount || 0) : stats.activeRatedUserCount }}</div>
        <div class="metric-sub" v-if="stats.ratedUserCount != null">
          总 {{ stats.ratedUserCount || 0 }}<span v-if="stats.inactiveRatedUserCount"> · 禁用 {{ stats.inactiveRatedUserCount }}</span>
        </div>
      </div>
      <div class="metric" :class="{ stale: stats.pendingRatedContestCount }">
        <div class="metric-label">待结算</div>
        <div class="metric-value">{{ stats.pendingRatedContestCount || 0 }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">样本不足</div>
        <div class="metric-value">{{ stats.sampleInsufficientContestCount || 0 }}</div>
      </div>
      <div class="metric" :class="{ stale: stats.pendingJudgementCount }">
        <div class="metric-label">待测提交</div>
        <div class="metric-value">{{ stats.pendingJudgementCount || 0 }}</div>
      </div>
      <div class="metric" :class="{ stale: stats.invalidLastSubmissionCount }">
        <div class="metric-label">无效最后提交</div>
        <div class="metric-value">{{ stats.invalidLastSubmissionCount || 0 }}</div>
        <div class="metric-sub" v-if="stats.invalidLastSubmissionContestCount">
          涉及 {{ stats.invalidLastSubmissionContestCount || 0 }} 场
        </div>
      </div>
      <div class="metric" :class="{ stale: stats.ratingDriftContestCount }">
        <div class="metric-label">需重算</div>
        <div class="metric-value">{{ stats.ratingDriftContestCount || 0 }}</div>
      </div>
      <div class="metric" :class="{ stale: stats.staleRatingRowCount }">
        <div class="metric-label">旧记录</div>
        <div class="metric-value">{{ stats.staleRatingRowCount || 0 }}</div>
        <div class="metric-sub" v-if="stats.nullKeyRatingRowCount">
          主键为空 {{ stats.nullKeyRatingRowCount }}
        </div>
      </div>
      <div class="metric" :class="{ stale: stats.duplicateRatingRowCount }">
        <div class="metric-label">重复记录</div>
        <div class="metric-value">{{ stats.duplicateRatingRowCount || 0 }}</div>
        <div class="metric-sub" v-if="stats.duplicateRatingPairCount">
          {{ stats.duplicateRatingPairCount || 0 }} 组
        </div>
      </div>
      <div class="metric" :class="{ stale: stats.ratingUniqueConstraintReady === false }">
        <div class="metric-label">唯一约束</div>
        <div class="metric-value constraint-state">
          {{ stats.ratingUniqueConstraintReady == null ? '-' : (stats.ratingUniqueConstraintReady ? '正常' : '未恢复') }}
        </div>
        <div class="metric-sub" v-if="stats.ratingPrimaryKeyWrongColumns && stats.ratingUniqueConstraintReady">
          已用唯一键保护
        </div>
      </div>
      <div class="metric" :class="{ stale: stats.ratingAuxiliaryIndexesReady === false }">
        <div class="metric-label">辅助索引</div>
        <div class="metric-value constraint-state">
          {{ stats.ratingAuxiliaryIndexesReady == null ? '-' : (stats.ratingAuxiliaryIndexesReady ? '正常' : '缺失') }}
        </div>
        <div class="metric-sub" v-if="ratingAuxiliaryIndexText">
          {{ ratingAuxiliaryIndexText }}
        </div>
      </div>
      <div class="metric" :class="{ stale: stats.ratingCacheMismatchCount }">
        <div class="metric-label">缓存差异</div>
        <div class="metric-value">{{ stats.activeRatingCacheMismatchCount == null ? (stats.ratingCacheMismatchCount || 0) : stats.activeRatingCacheMismatchCount }}</div>
        <div class="metric-sub" v-if="stats.ratingCacheMismatchCount != null">
          总 {{ stats.ratingCacheMismatchCount || 0 }}<span v-if="stats.inactiveRatingCacheMismatchCount"> · 禁用 {{ stats.inactiveRatingCacheMismatchCount }}</span>
        </div>
      </div>
    </section>

    <el-alert v-if="stats.staleRatingRowCount" class="stale-alert" type="warning" show-icon :closable="false"
      :title="staleAlertText" />
    <el-alert v-if="stats.duplicateRatingRowCount" class="stale-alert" type="warning" show-icon :closable="false"
      :title="duplicateAlertText" />
    <el-alert v-if="stats.ratingUniqueConstraintReady === false" class="stale-alert" type="warning" show-icon
      :closable="false" :title="uniqueConstraintAlertText" />
    <el-alert v-if="stats.ratingAuxiliaryIndexesReady === false" class="stale-alert" type="warning" show-icon
      :closable="false" :title="auxiliaryIndexAlertText" />
    <el-alert v-if="stats.ratingCacheMismatchCount" class="stale-alert" type="warning" show-icon :closable="false"
      :title="cacheMismatchAlertText" />
    <el-alert v-if="stats.pendingRatedContestCount" class="stale-alert" type="warning" show-icon :closable="false"
      :title="`检测到 ${stats.pendingRatedContestCount} 场已结束 Rated 比赛尚未结算`" />
    <el-alert v-if="stats.sampleInsufficientContestCount" class="stale-alert" type="info" show-icon :closable="false"
      :title="`${stats.sampleInsufficientContestCount} 场已结束 Rated 比赛因提交人数不足未产生 Rating`" />
    <el-alert v-if="stats.pendingJudgementCount" class="stale-alert" type="warning" show-icon :closable="false"
      :title="`仍有 ${stats.pendingJudgementCount} 个影响 Rating 的最后提交未完成评测，涉及 ${stats.pendingJudgementContestCount || 0} 场比赛`" />
    <el-alert v-if="stats.invalidLastSubmissionCount" class="stale-alert" type="warning" show-icon :closable="false"
      :title="invalidLastSubmissionAlertText" />
    <el-alert v-if="stats.ratingDriftContestCount" class="stale-alert" type="warning" show-icon :closable="false"
      :title="`检测到 ${stats.ratingDriftContestCount} 场已结算比赛的 Rating 与当前榜单不一致`" />
    <el-alert v-if="stats.ratingDriftTimelineBlocked" class="stale-alert" type="info" show-icon :closable="false"
      :title="driftAuditBlockedText" />

    <section class="panel" v-if="staleRatings.length || stats.staleRatingContestCount">
      <div class="panel-title">
        <el-icon><Tickets /></el-icon>
        旧记录
        <span class="panel-title-note">
          显示 {{ staleRatings.length || 0 }} 组 / {{ stats.staleRatingRowCount || 0 }} 条
        </span>
      </div>
      <el-table :data="staleRatings" v-loading="loading" empty-text="暂无旧 Rating 记录">
        <el-table-column label="比赛" min-width="220">
          <template #default="scope">
            <router-link v-if="scope.row.start" class="contest-link" :to="'/contest/' + scope.row.cid">
              {{ scope.row.title }}
            </router-link>
            <div v-else class="contest-link">{{ scope.row.title }}</div>
            <div class="muted">CID {{ scope.row.cid == null ? '-' : scope.row.cid }}<span v-if="scope.row.start"> · {{ scope.row.start }}</span></div>
          </template>
        </el-table-column>
        <el-table-column prop="rowCount" label="记录" width="90" />
        <el-table-column label="原因" width="130">
          <template #default="scope">
            <el-tag type="warning" effect="plain">{{ staleReasonLabel(scope.row.reason) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default>
            <el-button size="small" type="warning" plain :loading="cleaning" @click="cleanupStaleRatings">
              清理
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel" v-if="duplicateRatings.length || stats.duplicateRatingPairCount">
      <div class="panel-title">
        <el-icon><Tickets /></el-icon>
        重复记录
        <span class="panel-title-note">
          显示 {{ duplicateRatings.length || 0 }} / {{ stats.duplicateRatingPairCount || 0 }} 组
        </span>
      </div>
      <el-table :data="duplicateRatings" v-loading="loading" empty-text="暂无重复 Rating 记录">
        <el-table-column label="比赛" min-width="220">
          <template #default="scope">
            <router-link v-if="scope.row.start" class="contest-link" :to="'/contest/' + scope.row.cid">
              {{ scope.row.title }}
            </router-link>
            <div v-else class="contest-link">{{ scope.row.title }}</div>
            <div class="muted">CID {{ scope.row.cid }}<span v-if="scope.row.start"> · {{ scope.row.start }}</span></div>
          </template>
        </el-table-column>
        <el-table-column label="用户" min-width="160">
          <template #default="scope">
            <router-link v-if="scope.row.username !== '已删除用户'" class="contest-link" :to="userProfilePath(scope.row.username)">
              {{ scope.row.username }}
            </router-link>
            <div v-else class="contest-link">{{ scope.row.username }}</div>
            <div class="muted">UID {{ scope.row.uid }}</div>
          </template>
        </el-table-column>
        <el-table-column label="记录" width="110">
          <template #default="scope">
            {{ scope.row.rowCount || 0 }} 条
            <div class="muted">多 {{ scope.row.duplicateRowCount || 0 }}</div>
          </template>
        </el-table-column>
        <el-table-column label="最近更新" width="190">
          <template #default="scope">
            {{ scope.row.lastUpdateTime || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default>
            <el-button size="small" type="warning" plain :loading="cleaning" @click="cleanupStaleRatings">
              清理
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel" v-if="cacheMismatches.length || stats.ratingCacheMismatchCount">
      <div class="panel-title">
        <el-icon><DataLine /></el-icon>
        缓存差异
        <span class="panel-title-note">
          显示 {{ cacheMismatches.length || 0 }} / 活跃 {{ stats.activeRatingCacheMismatchCount == null ? (stats.ratingCacheMismatchCount || 0) : stats.activeRatingCacheMismatchCount }} / 总 {{ stats.ratingCacheMismatchCount || 0 }}
        </span>
      </div>
      <el-table :data="cacheMismatches" v-loading="loading" empty-text="暂无缓存差异">
        <el-table-column label="用户" min-width="180">
          <template #default="scope">
            <router-link class="contest-link" :to="userProfilePath(scope.row.username)">{{ scope.row.username }}</router-link>
            <div class="muted">
              UID {{ scope.row.uid }}
              <el-tag v-if="!scope.row.inUse" class="user-state-tag" size="small" type="info" effect="plain">禁用</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="cachedRating" label="缓存" width="110" />
        <el-table-column prop="historyRating" label="有效历史" width="120" />
        <el-table-column label="差值" width="110">
          <template #default="scope">
            <el-tag :type="deltaType(scope.row.delta)" effect="plain">{{ signedDelta(scope.row.delta) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default>
            <el-button size="small" type="primary" plain :loading="syncing" @click="syncRatingCache">
              同步缓存
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel" v-if="judging.length || stats.pendingJudgementCount">
      <div class="panel-title">
        <el-icon><Warning /></el-icon>
        等待测评
        <span class="panel-title-note">
          显示 {{ judging.length || 0 }} / {{ stats.pendingJudgementContestCount || 0 }} 场
        </span>
      </div>
      <el-table :data="judging" v-loading="loading" empty-text="暂无等待测评的 Rated 比赛">
        <el-table-column label="比赛" min-width="220">
          <template #default="scope">
            <router-link class="contest-link" :to="'/contest/' + scope.row.cid">{{ scope.row.title }}</router-link>
            <div class="muted">{{ scope.row.start }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="pendingJudgementCount" label="待测提交" width="110" />
        <el-table-column prop="pendingUserCount" label="用户" width="90" />
        <el-table-column prop="pendingProblemCount" label="题目" width="90" />
        <el-table-column label="Rating" width="110">
          <template #default="scope">
            <el-tag :type="scope.row.ratingRowCount ? 'warning' : 'info'" effect="plain">
              {{ scope.row.ratingRowCount ? '需重算' : '未结算' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="scope">
            <el-button-group>
              <el-button size="small" @click="previewPendingContest(scope.row)">预览</el-button>
              <el-button size="small" @click="$router.push({ path: '/contest/' + scope.row.cid, query: { tab: 'submission' } })">
                提交
              </el-button>
            </el-button-group>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel" v-if="invalidLastSubmissions.length || stats.invalidLastSubmissionCount">
      <div class="panel-title">
        <el-icon><Warning /></el-icon>
        无效最后提交
        <span class="panel-title-note">
          显示 {{ invalidLastSubmissions.length || 0 }} / {{ stats.invalidLastSubmissionCount || 0 }} 条
        </span>
      </div>
      <el-table :data="invalidLastSubmissions" v-loading="loading" empty-text="暂无无效最后提交">
        <el-table-column label="比赛" min-width="220">
          <template #default="scope">
            <router-link class="contest-link" :to="'/contest/' + scope.row.cid">{{ scope.row.title }}</router-link>
            <div class="muted">CID {{ scope.row.cid }} · {{ scope.row.start }}</div>
          </template>
        </el-table-column>
        <el-table-column label="用户" min-width="160">
          <template #default="scope">
            <router-link v-if="!scope.row.missingUser" class="contest-link" :to="userProfilePath(scope.row.username)">
              {{ scope.row.username }}
            </router-link>
            <div v-else class="contest-link">{{ scope.row.username }}</div>
            <div class="muted">UID {{ scope.row.uid }}</div>
          </template>
        </el-table-column>
        <el-table-column label="记录" width="130">
          <template #default="scope">
            <router-link v-if="scope.row.sid && !scope.row.missingSubmission" class="contest-link" :to="'/submission/' + scope.row.sid">
              SID {{ scope.row.sid }}
            </router-link>
            <span v-else>SID {{ scope.row.sid || '-' }}</span>
            <div class="muted">PID {{ scope.row.pid || '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="原因" min-width="190">
          <template #default="scope">
            <el-tag type="warning" effect="plain">{{ invalidLastSubmissionReasonLabel(scope.row.reason) }}</el-tag>
            <div class="muted">
              <span v-if="scope.row.missingUser">用户不存在</span>
              <span v-else-if="scope.row.notContestPlayer">未注册参赛</span>
              <span v-else-if="scope.row.missingSubmission">提交不存在或不匹配</span>
              <span v-else>状态异常</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160">
          <template #default="scope">
            <el-button size="small" @click="$router.push({ path: '/contest/' + scope.row.cid, query: { tab: 'rank' } })">
              排行榜
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel" v-if="drift.length || stats.ratingDriftContestCount">
      <div class="panel-title">
        <el-icon><Warning /></el-icon>
        需重算
        <span class="panel-title-note">
          显示 {{ drift.length || 0 }} / {{ stats.ratingDriftContestCount || 0 }} 场
        </span>
      </div>
      <el-table :data="drift" v-loading="loading" empty-text="暂无需重算比赛">
        <el-table-column label="比赛" min-width="220">
          <template #default="scope">
            <router-link class="contest-link" :to="'/contest/' + scope.row.cid">{{ scope.row.title }}</router-link>
            <div class="muted">{{ scope.row.start }}</div>
          </template>
        </el-table-column>
        <el-table-column label="记录" width="110">
          <template #default="scope">
            {{ scope.row.rowCount || 0 }} / {{ scope.row.expectedRowCount || 0 }}
          </template>
        </el-table-column>
        <el-table-column prop="diffUserCount" label="差异用户" width="110" />
        <el-table-column label="原因" min-width="160">
          <template #default="scope">
            <el-tag type="warning" effect="plain">{{ driftReasonLabel(scope.row.reason) }}</el-tag>
            <div class="muted">{{ driftMismatchText(scope.row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230">
          <template #default="scope">
            <el-button-group>
              <el-button size="small" :loading="previewingCid === scope.row.cid" @click="previewPendingContest(scope.row)">
                预览
              </el-button>
              <el-button size="small" type="primary" :loading="settlingCid === scope.row.cid"
                @click="settlePendingContest(scope.row, '重算')">
                重算
              </el-button>
              <el-button size="small" @click="$router.push({ path: '/contest/' + scope.row.cid, query: { tab: 'manageC' } })">
                管理
              </el-button>
            </el-button-group>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel" v-if="pending.length || stats.pendingRatedContestCount">
      <div class="panel-title">
        <el-icon><Warning /></el-icon>
        待结算
        <span class="panel-title-note">
          显示 {{ pending.length || 0 }} / {{ stats.pendingRatedContestCount || 0 }} 场
        </span>
      </div>
      <el-table :data="pending" v-loading="loading" empty-text="暂无待结算比赛">
        <el-table-column label="比赛" min-width="220">
          <template #default="scope">
            <router-link class="contest-link" :to="'/contest/' + scope.row.cid">{{ scope.row.title }}</router-link>
            <div class="muted">{{ scope.row.start }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="submittedUserCount" label="提交人数" width="120" />
        <el-table-column label="待测" width="150">
          <template #default="scope">
            <el-tag v-if="scope.row.pendingJudgementCount" type="warning" effect="dark">
              {{ scope.row.pendingJudgementCount }}
            </el-tag>
            <span v-else>0</span>
            <div v-if="ratingPendingJudgementDetail(scope.row)" class="muted status-detail">
              {{ ratingPendingJudgementDetail(scope.row) }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230">
          <template #default="scope">
            <el-button-group>
              <el-button size="small" :loading="previewingCid === scope.row.cid" @click="previewPendingContest(scope.row)">
                预览
              </el-button>
              <el-button size="small" type="primary" :loading="settlingCid === scope.row.cid"
                :disabled="!!scope.row.pendingJudgementCount" @click="settlePendingContest(scope.row)">
                结算
              </el-button>
              <el-button size="small" @click="$router.push({ path: '/contest/' + scope.row.cid, query: { tab: 'manageC' } })">
                管理
              </el-button>
            </el-button-group>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel" v-if="sampleInsufficient.length || stats.sampleInsufficientContestCount">
      <div class="panel-title">
        <el-icon><Tickets /></el-icon>
        样本不足
        <span class="panel-title-note">
          显示 {{ sampleInsufficient.length || 0 }} / {{ stats.sampleInsufficientContestCount || 0 }} 场
        </span>
      </div>
      <el-table :data="sampleInsufficient" v-loading="loading" empty-text="暂无样本不足比赛">
        <el-table-column label="比赛" min-width="220">
          <template #default="scope">
            <router-link class="contest-link" :to="'/contest/' + scope.row.cid">{{ scope.row.title }}</router-link>
            <div class="muted">{{ scope.row.start }}</div>
          </template>
        </el-table-column>
        <el-table-column label="提交人数" width="130">
          <template #default="scope">
            {{ scope.row.submittedUserCount || 0 }} / {{ scope.row.minParticipantCount || policy.minParticipants || 2 }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="scope">
            <el-button size="small" @click="$router.push({ path: '/contest/' + scope.row.cid, query: { tab: 'rank' } })">
              排行榜
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel">
      <div class="panel-title">
        <el-icon><DataLine /></el-icon>
        最近结算
      </div>
      <el-table :data="recent" v-loading="loading" empty-text="暂无 Rating 记录">
        <el-table-column label="比赛" min-width="220">
          <template #default="scope">
            <router-link class="contest-link" :to="'/contest/' + scope.row.cid">{{ scope.row.title }}</router-link>
            <div class="muted">{{ scope.row.start }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="count" label="人数" width="100" />
        <el-table-column prop="updateTime" label="结算时间" width="190" />
        <el-table-column label="操作" width="90">
          <template #default="scope">
            <el-button size="small" text type="primary" @click="previewPendingContest(scope.row)">
              查看
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel" v-if="lastResult">
      <div class="panel-title">
        <el-icon><Tickets /></el-icon>
        {{ lastResult.dryRun ? '重建预检' : '重建结果' }}
        <el-tag v-if="lastResult.dryRun" type="info" effect="plain">未写入</el-tag>
        <span class="panel-title-note">
          显示 {{ lastResult.returnedContestCount || (lastResult.contests || []).length || 0 }} / {{ lastResult.contestCount || 0 }} 场
        </span>
      </div>
      <el-alert v-if="lastResult.timelineBlocked" class="stale-alert" type="warning" show-icon :closable="false"
        :title="rebuildBlockedText" />
      <el-alert v-if="lastResult.hasMoreContests" class="stale-alert" type="info" show-icon :closable="false"
        :title="rebuildResultLimitText" />
      <div class="result-grid">
        <div class="result-item">
          <span>处理比赛</span>
          <strong>{{ lastResult.contestCount || 0 }}</strong>
        </div>
        <div class="result-item">
          <span>{{ rebuildMetricPrefix }}记录</span>
          <strong>{{ rebuildRowMetric }}</strong>
        </div>
        <div class="result-item">
          <span>{{ rebuildMetricPrefix }}用户</span>
          <strong>{{ rebuildUserMetric }}</strong>
        </div>
        <div class="result-item">
          <span>跳过比赛</span>
          <strong>{{ lastResult.skippedContestCount || 0 }}</strong>
        </div>
      </div>
      <el-table :data="lastResult.contests || []" max-height="360" empty-text="暂无比赛">
        <el-table-column label="比赛" min-width="220">
          <template #default="scope">
            <router-link class="contest-link" :to="'/contest/' + scope.row.cid">{{ scope.row.title }}</router-link>
            <div class="muted">{{ scope.row.start }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="count" label="评级人数" width="120" />
        <el-table-column label="状态" width="160">
          <template #default="scope">
            <el-tag v-if="scope.row.skippedReason === 'pendingJudgement'" type="warning">
              待测 {{ scope.row.pendingJudgementCount || 0 }}
            </el-tag>
            <el-tag v-else-if="scope.row.skippedReason === 'timelineBlocked'" type="danger">
              时间线阻塞
            </el-tag>
            <el-tag v-else-if="scope.row.skippedReason === 'sampleInsufficient'" type="info">
              样本 {{ scope.row.submittedUserCount || 0 }}/{{ scope.row.minParticipantCount || policy.minParticipants || 2 }}
            </el-tag>
            <span v-else>{{ rebuildContestStatusText(scope.row) }}</span>
            <div v-if="rebuildContestStatusDetail(scope.row)" class="muted status-detail">
              {{ rebuildContestStatusDetail(scope.row) }}
            </div>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="previewVisible" title="Rating 变化" width="min(760px, 92vw)" destroy-on-close>
      <div class="preview-head">
        <div>
          <strong>{{ previewContest.title || '比赛' }}</strong>
          <div class="muted">
            {{ previewContest.start }}
            <span v-if="previewMeta.count != null"> · 共 {{ previewMeta.count || 0 }} 名选手</span>
          </div>
        </div>
        <el-tag :type="previewTagType">{{ previewTagText }}</el-tag>
      </div>
      <el-alert v-if="previewMeta.hasMoreChanges" class="stale-alert" type="info" show-icon :closable="false"
        :title="previewLimitText" />
      <el-alert v-if="previewMeta.blocked" class="stale-alert" type="warning" show-icon :closable="false"
        :title="previewConflictText" />
      <el-alert v-if="previewMeta.pendingJudgement" class="stale-alert" type="warning" show-icon :closable="false"
        :title="previewPendingText" />
      <el-alert v-if="previewMeta.sampleInsufficient" class="stale-alert" type="info" show-icon :closable="false"
        :title="previewSampleInsufficientText" />
      <el-alert v-if="previewMeta.drifted" class="stale-alert" type="warning" show-icon :closable="false"
        :title="previewDriftText" :description="previewDriftDetailText" />
      <el-table :data="previewRows" v-loading="previewingCid !== null" max-height="520" empty-text="暂无可评级选手">
        <el-table-column prop="rank" label="排名" width="80" />
        <el-table-column label="用户" min-width="150">
          <template #default="scope">
            <div class="contest-link">{{ scope.row.username }}</div>
            <div class="muted">UID {{ scope.row.uid }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="totalScore" label="分数" width="90" />
        <el-table-column label="Rating" min-width="160">
          <template #default="scope">
            <span class="rating-new">{{ scope.row.newRating }}</span>
            <span class="muted"> {{ scope.row.oldRating }} -> {{ scope.row.newRating }}</span>
          </template>
        </el-table-column>
        <el-table-column label="变化" width="90">
          <template #default="scope">
            <el-tag :type="deltaType(scope.row.delta)" effect="dark">{{ signedDelta(scope.row.delta) }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="previewVisible = false">关闭</el-button>
        <el-button v-if="previewCanSettle" type="primary" :loading="settlingCid === previewContest.cid"
          @click="settlePendingContest(previewContest, previewActionText)">
          {{ previewApplyText }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import axios from 'axios';
import { ElMessageBox } from 'element-plus';
import { userProfilePath } from '@/assets/common';

export default {
  name: 'ratingTool',
  data() {
    return {
      loading: false,
      rebuilding: false,
      cleaning: false,
      syncing: false,
      previewingCid: null,
      settlingCid: null,
      previewingRebuild: false,
      stats: {},
      policy: {},
      recent: [],
      staleRatings: [],
      staleReasonCounts: [],
      duplicateRatings: [],
      pending: [],
      sampleInsufficient: [],
      judging: [],
      invalidLastSubmissions: [],
      invalidLastSubmissionReasonCounts: [],
      cacheMismatches: [],
      cacheMismatchReasonCounts: [],
      drift: [],
      lastResult: null,
      previewVisible: false,
      previewContest: {},
      previewMeta: {},
      previewRows: [],
      listLimit: 10,
      previewDetailLimit: 100,
    };
  },
  computed: {
    previewTagType() {
      if (this.previewMeta.unrated) return 'info';
      if (this.previewMeta.sampleInsufficient) return 'info';
      if (this.previewMeta.pendingJudgement) return 'warning';
      if (this.previewMeta.blocked) return 'danger';
      if (this.previewMeta.drifted) return 'danger';
      if (this.previewMeta.settled) return 'warning';
      return 'success';
    },
    previewTagText() {
      if (this.previewMeta.unrated) return 'Unrated';
      if (this.previewMeta.sampleInsufficient) return '样本不足';
      if (this.previewMeta.pendingJudgement) return '等待测评';
      if (this.previewMeta.blocked) return '需重建';
      if (this.previewMeta.drifted) return '需重算';
      if (this.previewMeta.settled) return '已结算';
      return '待结算';
    },
    previewCanSettle() {
      return !!this.previewContest.cid
        && !this.previewMeta.unrated
        && !this.previewMeta.sampleInsufficient
        && !this.previewMeta.blocked
        && !this.previewMeta.pendingJudgement
        && (!this.previewMeta.settled || this.previewMeta.drifted)
        && this.previewRows.length > 0;
    },
    previewApplyText() {
      return `${this.previewActionText}本场`;
    },
    previewActionText() {
      return this.previewMeta.settled ? '重算' : '结算';
    },
    previewConflictText() {
      const conflict = this.previewMeta.conflict || {};
      const title = conflict.title ? `（${conflict.title}）` : '';
      return `已有后续比赛 Rating${title}，请按时间顺序全量重建`;
    },
    previewPendingText() {
      return `还有 ${this.previewMeta.pendingJudgementCount || 0} 个最后提交未完成评测${this.ratingPendingJudgementDetail(this.previewMeta)}${this.ratingInvalidLastSubmissionTail(this.previewMeta)}，完成后才能结算 Rating`;
    },
    previewSampleInsufficientText() {
      return `提交人数 ${this.previewMeta.submittedUserCount || 0}/${this.previewMeta.minParticipantCount || this.policy.minParticipants || 2}${this.ratingInvalidLastSubmissionTail(this.previewMeta)}，本场不会产生 Rating`;
    },
    previewLimitText() {
      const returned = this.previewMeta.returnedCount || this.previewRows.length || 0;
      const omitted = this.previewMeta.omittedCount || 0;
      const limit = this.previewMeta.detailLimit || this.previewDetailLimit || returned;
      return `当前只显示前 ${returned} 名 Rating 变化（上限 ${limit}），另有 ${omitted} 名未展开`;
    },
    previewDriftText() {
      return `当前预览与已保存 Rating 不一致，涉及 ${this.previewMeta.driftDiffUserCount || 0} 名选手`;
    },
    previewDriftDetailText() {
      return this.formatDriftMismatch(this.previewMeta.driftFirstMismatch || {});
    },
    rebuildBlockedText() {
      const contest = this.lastResult && this.lastResult.blockedByContest;
      const blockedText = this.lastResult && this.lastResult.dryRun
        ? '当前预检未写入 Rating 历史'
        : '未写入任何 Rating 变更';
      if (!contest) return `全量重建已在待测比赛处停止，${blockedText}`;
      const details = [];
      if (contest.pendingJudgementUserCount) details.push(`${contest.pendingJudgementUserCount} 名用户`);
      if (contest.pendingJudgementProblemCount) details.push(`${contest.pendingJudgementProblemCount} 题`);
      const detailText = details.length ? `（${details.join(' / ')}）` : '';
      return `全量重建已在「${contest.title}」停止：还有 ${contest.pendingJudgementCount || 0} 个最后提交未完成评测${detailText}${this.ratingInvalidLastSubmissionTail(contest)}，${blockedText}`;
    },
    rebuildResultLimitText() {
      if (!this.lastResult) return '';
      const returned = this.lastResult.returnedContestCount || (this.lastResult.contests || []).length || 0;
      const omitted = this.lastResult.omittedContestCount || 0;
      const limit = this.lastResult.outputLimit || this.listLimit || returned;
      return `当前只显示前 ${returned} 场重建明细（上限 ${limit}），另有 ${omitted} 场未展开`;
    },
    rebuildMetricPrefix() {
      if (!this.lastResult) return '产生';
      return this.lastResult.dryRun || this.lastResult.writeSkipped ? '预计' : '写入';
    },
    rebuildRowMetric() {
      if (!this.lastResult) return 0;
      if (!this.lastResult.dryRun && !this.lastResult.writeSkipped) {
        return this.lastResult.writtenRowCount || this.lastResult.rowCount || 0;
      }
      return this.lastResult.rowCount || 0;
    },
    rebuildUserMetric() {
      if (!this.lastResult) return 0;
      if (!this.lastResult.dryRun && !this.lastResult.writeSkipped) {
        return this.lastResult.writtenUserCount || this.lastResult.ratedUserCount || 0;
      }
      return this.lastResult.ratedUserCount || 0;
    },
    driftAuditBlockedText() {
      const contest = this.stats.ratingDriftBlockedByContest || {};
      if (!contest.title) return 'Rating 漂移审计已在待测比赛处停止，后续比赛暂未检查';
      return `Rating 漂移审计已在「${contest.title}」停止，后续比赛暂未检查`;
    },
    staleAlertText() {
      const base = `检测到 ${this.stats.staleRatingRowCount || 0} 条旧 Rating 记录，涉及 ${this.stats.staleRatingContestCount || 0} 场比赛`;
      const nullKeyText = this.stats.nullKeyRatingRowCount
        ? `，其中 ${this.stats.nullKeyRatingRowCount} 条主键为空`
        : '';
      if (!this.staleReasonCounts.length) return `${base}${nullKeyText}`;
      const reasons = this.staleReasonCounts
        .map((row) => `${this.staleReasonLabel(row.reason)} ${row.rowCount || 0}`)
        .join('，');
      return `${base}${nullKeyText}（${reasons}）`;
    },
    duplicateAlertText() {
      const rows = this.stats.duplicateRatingRowCount || 0;
      const pairs = this.stats.duplicateRatingPairCount || 0;
      const contests = this.stats.duplicateRatingContestCount || 0;
      return `检测到 ${rows} 条重复 Rating 记录，涉及 ${pairs} 个比赛-用户组合、${contests} 场比赛`;
    },
    uniqueConstraintAlertText() {
      const duplicatePairs = this.stats.ratingUniqueConstraintDuplicatePairCount || this.stats.duplicateRatingPairCount || 0;
      const nullKeys = this.stats.ratingUniqueConstraintNullKeyRowCount || this.stats.nullKeyRatingRowCount || 0;
      return `contestRating 尚未恢复 (cid, uid) 唯一约束：重复 ${duplicatePairs} 组，主键为空 ${nullKeys} 行`;
    },
    ratingAuxiliaryIndexText() {
      const uidNames = this.stats.ratingUidIndexNames || [];
      const rankNames = this.stats.ratingCidRankIndexNames || [];
      if (this.stats.ratingAuxiliaryIndexesReady === false) {
        const missing = [];
        if (!this.stats.ratingUidIndexReady) missing.push('uid');
        if (!this.stats.ratingCidRankIndexReady) missing.push('cid+rank');
        return missing.length ? `缺 ${missing.join('、')}` : '';
      }
      if (!uidNames.length && !rankNames.length) return '';
      return `uid ${uidNames[0] || '-'} · rank ${rankNames[0] || '-'}`;
    },
    auxiliaryIndexAlertText() {
      const missing = [];
      if (!this.stats.ratingUidIndexReady) missing.push('uid');
      if (!this.stats.ratingCidRankIndexReady) missing.push('cid+rank');
      const missingText = missing.length ? `缺少 ${missing.join('、')} 索引` : '辅助索引未完整恢复';
      return `contestRating ${missingText}，Rating 管理统计可能变慢`;
    },
    cacheMismatchAlertText() {
      const activeCount = this.stats.activeRatingCacheMismatchCount == null
        ? (this.stats.ratingCacheMismatchCount || 0)
        : (this.stats.activeRatingCacheMismatchCount || 0);
      const inactiveCount = this.stats.inactiveRatingCacheMismatchCount || 0;
      const base = `检测到 ${activeCount} 个活跃用户当前 Rating 与有效历史不一致`;
      if (!this.cacheMismatchReasonCounts.length) return base;
      const reasons = this.cacheMismatchReasonCounts
        .map((row) => this.cacheMismatchReasonText(row))
        .join('，');
      const inactiveText = inactiveCount ? `，另有禁用用户 ${inactiveCount}` : '';
      return `${base}${inactiveText}（${reasons}）`;
    },
    invalidLastSubmissionAlertText() {
      const base = `检测到 ${this.stats.invalidLastSubmissionCount || 0} 条无效最后提交，涉及 ${this.stats.invalidLastSubmissionContestCount || 0} 场 Rated 比赛`;
      if (!this.invalidLastSubmissionReasonCounts.length) return base;
      const reasons = this.invalidLastSubmissionReasonCounts
        .map((row) => `${this.invalidLastSubmissionReasonLabel(row.reason)} ${row.rowCount || 0}`)
        .join('，');
      return `${base}（${reasons}）`;
    },
    cleanupDisabled() {
      return !this.stats.staleRatingRowCount
        && !this.stats.duplicateRatingRowCount
        && this.stats.ratingUniqueConstraintReady !== false
        && this.stats.ratingAuxiliaryIndexesReady !== false;
    },
  },
  methods: {
    userProfilePath,
    async fetchStats() {
      this.loading = true;
      try {
        const res = await axios.post('/api/contest/getRatingSystemStats', {
          limit: this.listLimit,
        });
        if (res.status === 200) {
          this.listLimit = Number(res.data.limit || this.listLimit || 10);
          this.stats = res.data.stats || {};
          this.policy = res.data.policy || {};
          this.recent = res.data.recent || [];
          this.staleRatings = res.data.stale || [];
          this.staleReasonCounts = res.data.staleReasonCounts || [];
          this.duplicateRatings = res.data.duplicates || [];
          this.pending = res.data.pending || [];
          this.sampleInsufficient = res.data.sampleInsufficient || [];
          this.judging = res.data.judging || [];
          this.invalidLastSubmissions = res.data.invalidLastSubmissions || [];
          this.invalidLastSubmissionReasonCounts = res.data.invalidLastSubmissionReasonCounts || [];
          this.cacheMismatches = res.data.cacheMismatches || [];
          this.cacheMismatchReasonCounts = res.data.cacheMismatchReasonCounts || [];
          this.drift = res.data.drift || [];
        } else {
          this.$message.error(res.data.message || '加载失败');
        }
      } catch (err) {
        this.$message.error('加载失败');
      } finally {
        this.loading = false;
      }
    },
    signedDelta(delta) {
      const value = Number(delta || 0);
      return value > 0 ? `+${value}` : String(value);
    },
    deltaType(delta) {
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
    ratingStorageTail(result) {
      if (!result) return '';
      const parts = [];
      if (result.primaryKeyAdded || result.uniqueKeyAdded) {
        parts.push(`已恢复唯一约束${result.uniqueKeyName ? ` ${result.uniqueKeyName}` : ''}`);
      } else if (result.ratingUniqueConstraintReady) {
        parts.push('唯一约束正常');
      } else if (result.ratingUniqueConstraintReady === false) {
        const duplicatePairs = result.ratingUniqueConstraintDuplicatePairCount || result.primaryKeySkippedDuplicatePairCount || 0;
        const nullKeys = result.ratingUniqueConstraintNullKeyRowCount || result.primaryKeySkippedNullKeyRowCount || 0;
        parts.push(`唯一约束仍未恢复（重复 ${duplicatePairs} 组 / 空主键 ${nullKeys} 行）`);
      }
      const auxiliaryNames = [result.uidIndexName, result.cidRankIndexName].filter(Boolean).join(' / ');
      if (result.uidIndexAdded || result.cidRankIndexAdded) {
        parts.push(`已恢复辅助索引${auxiliaryNames ? ` ${auxiliaryNames}` : ''}`);
      } else if (result.ratingAuxiliaryIndexesReady) {
        parts.push('辅助索引正常');
      } else if (result.ratingAuxiliaryIndexesReady === false) {
        parts.push('辅助索引仍未恢复');
      }
      return parts.length ? `，${parts.join('，')}` : '';
    },
    ratingInvalidLastSubmissionTail(rating) {
      const count = Number(rating && rating.invalidLastSubmissionCount || 0);
      return count ? `，另有 ${count} 条无效最后提交未计入` : '';
    },
    ratingPendingJudgementDetail(rating) {
      const userCount = Number(rating && (rating.pendingJudgementUserCount || rating.pendingUserCount) || 0);
      const problemCount = Number(rating && (rating.pendingJudgementProblemCount || rating.pendingProblemCount) || 0);
      const parts = [];
      if (userCount) parts.push(`${userCount} 名用户`);
      if (problemCount) parts.push(`${problemCount} 题`);
      return parts.length ? `（${parts.join(' / ')}）` : '';
    },
    rebuildContestStatusText(row) {
      if (!row || !row.count) return '已跳过';
      if (!this.lastResult || this.lastResult.dryRun || this.lastResult.writeSkipped) return '预计';
      return '已写入';
    },
    rebuildContestStatusDetail(row) {
      if (!row) return '';
      const parts = [];
      if (row.skippedReason === 'pendingJudgement') {
        const pendingParts = [];
        if (row.pendingJudgementUserCount) pendingParts.push(`${row.pendingJudgementUserCount} 名用户`);
        if (row.pendingJudgementProblemCount) pendingParts.push(`${row.pendingJudgementProblemCount} 题`);
        if (pendingParts.length) parts.push(pendingParts.join(' / '));
      }
      if (row.invalidLastSubmissionCount) {
        parts.push(`无效 ${row.invalidLastSubmissionCount} 条`);
      }
      return parts.join(' · ');
    },
    staleReasonLabel(reason) {
      const labels = {
        nullKey: '主键为空',
        missingContest: '比赛已删除',
        missingUser: '用户已删除',
        contestReopened: '比赛已重开',
        contestUnrated: '已改 Unrated',
        unknown: '状态异常',
      };
      return labels[reason] || '状态异常';
    },
    cacheMismatchReasonLabel(reason) {
      const labels = {
        orphanCache: '缓存无历史',
        missingCache: '未同步历史',
        cacheHigher: '缓存偏高',
        cacheLower: '缓存偏低',
        unknown: '状态异常',
      };
      return labels[reason] || '状态异常';
    },
    invalidLastSubmissionReasonLabel(reason) {
      const labels = {
        missingUser: '用户已删除',
        notContestPlayer: '非参赛用户',
        missingSubmission: '提交缺失',
        unknown: '状态异常',
      };
      return labels[reason] || '状态异常';
    },
    cacheMismatchReasonText(row) {
      const active = row.activeUserCount == null ? (row.userCount || 0) : (row.activeUserCount || 0);
      const inactive = row.inactiveUserCount || 0;
      const disabled = inactive ? ` / 禁用 ${inactive}` : '';
      return `${this.cacheMismatchReasonLabel(row.reason)} ${active}${disabled}`;
    },
    driftReasonLabel(reason) {
      const labels = {
        participantChanged: '选手变化',
        missingRows: '缺少记录',
        extraRows: '多余记录',
        algorithmChanged: '算法版本',
        ratingTimelineChanged: '时间线变化',
        standingChanged: '榜单变化',
        changedRows: '榜单变化',
      };
      return labels[reason] || '榜单变化';
    },
    driftMismatchText(row) {
      return this.formatDriftMismatch(row.firstMismatch || {});
    },
    formatDriftMismatch(mismatch) {
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
    async previewPendingContest(row) {
      this.previewContest = row || {};
      this.previewMeta = {};
      this.previewRows = [];
      this.previewVisible = true;
      this.previewingCid = row.cid;
      try {
        const res = await axios.post('/api/contest/previewRating', {
          cid: row.cid,
          detailLimit: this.previewDetailLimit,
        });
        if (res.status === 200) {
          const rating = res.data.rating || {};
          this.previewMeta = rating;
          this.previewRows = rating.data || [];
        } else {
          this.$message.error(res.data.message || '预览失败');
        }
      } catch (err) {
        this.$message.error('预览失败');
      } finally {
        this.previewingCid = null;
      }
    },
    async settlePendingContest(row, action = '结算') {
      if (row.pendingJudgementCount) {
        this.$message.warning(`还有 ${row.pendingJudgementCount} 个最后提交未完成评测${this.ratingPendingJudgementDetail(row)}`);
        return;
      }
      const rebuilding = action === '重算';
      try {
        await ElMessageBox.confirm(
          `将按当前排行榜${action}「${row.title}」的 Rating。`,
          rebuilding ? '确认重算' : '确认结算',
          { type: 'warning', confirmButtonText: action, cancelButtonText: '取消' }
        );
      } catch (_) {
        return;
      }
      this.settlingCid = row.cid;
      try {
        const res = await axios.post('/api/contest/settleContestRating', { cid: row.cid });
        if (res.status === 200) {
          const rating = res.data.rating || {};
          const syncTail = this.ratingSyncTail(rating);
          const storageTail = this.ratingStorageTail(rating);
          const invalidTail = this.ratingInvalidLastSubmissionTail(rating);
          if (rating.sampleInsufficient) {
            this.$message.success(`样本不足，本场未产生 Rating（${rating.submittedUserCount || 0}/${rating.minParticipantCount || this.policy.minParticipants || 2}${invalidTail}）${syncTail}${storageTail}`);
          } else {
            this.$message.success(`已${rating.rebuilt || rebuilding ? '重算' : '结算'} ${rating.count || 0} 名选手 Rating${syncTail}${storageTail}`);
          }
          this.previewVisible = false;
          this.lastResult = {
            contestCount: 1,
            rowCount: rating.count || 0,
            ratedUserCount: rating.count || 0,
            skippedContestCount: 0,
            contests: [{ cid: row.cid, title: row.title, start: row.start, count: rating.count || 0 }],
          };
          await this.fetchStats();
        } else {
          this.$message.error(res.data.message || '结算失败');
        }
      } catch (err) {
        this.$message.error('结算失败');
      } finally {
        this.settlingCid = null;
      }
    },
    async rebuildRatings() {
      try {
        await ElMessageBox.confirm(
          '将清空现有 Rating 历史，并按全部已结束比赛的时间顺序重新结算。',
          '确认全量重建',
          { type: 'warning', confirmButtonText: '重建', cancelButtonText: '取消' }
        );
      } catch (_) {
        return;
      }
      this.rebuilding = true;
      try {
        const res = await axios.post('/api/contest/rebuildContestRatings', {
          limit: this.listLimit,
        });
        if (res.status === 200) {
          this.lastResult = res.data.rating || null;
          if (this.lastResult && this.lastResult.timelineBlocked) {
            this.$message.warning(this.lastResult.writeSkipped
              ? 'Rating 重建被首个待测比赛阻塞，未写入任何变更'
              : 'Rating 已重建到首个待测比赛之前');
          } else {
            this.$message.success(`Rating 已重建${this.ratingStorageTail(this.lastResult)}`);
          }
          await this.fetchStats();
        } else {
          this.$message.error(res.data.message || '重建失败');
        }
      } catch (err) {
        this.$message.error('重建失败');
      } finally {
        this.rebuilding = false;
      }
    },
    async previewRebuildRatings() {
      this.previewingRebuild = true;
      try {
        const res = await axios.post('/api/contest/previewContestRatingRebuild', {
          limit: this.listLimit,
        });
        if (res.status === 200) {
          this.lastResult = res.data.rating || null;
          if (this.lastResult && this.lastResult.timelineBlocked) {
            this.$message.warning('预检发现 Rating 时间线会在待测比赛处停止');
          } else {
            this.$message.success('预检完成，未写入 Rating 历史');
          }
        } else {
          this.$message.error(res.data.message || '预检失败');
        }
      } catch (err) {
        this.$message.error('预检失败');
      } finally {
        this.previewingRebuild = false;
      }
    },
    async cleanupStaleRatings() {
      try {
        await ElMessageBox.confirm(
          '将删除无效 Rating 记录、合并重复历史、恢复缺失约束/索引，并用现有有效 Rating 历史同步用户当前 Rating。若有效历史本身不可信，请使用全量重建。',
          '确认清理异常',
          { type: 'warning', confirmButtonText: '清理', cancelButtonText: '取消' }
        );
      } catch (_) {
        return;
      }
      this.cleaning = true;
      try {
        const res = await axios.post('/api/contest/cleanupStaleContestRatings');
        if (res.status === 200) {
          const result = res.data.cleanup || {};
          const tail = result.ratingCacheMismatchAfter
            ? `，仍有 ${result.ratingCacheMismatchAfter} 个缓存差异`
            : '';
          const duplicateText = result.deduplicatedRowCount
            ? `，去重 ${result.deduplicatedRowCount} 条重复记录`
            : '';
          const duplicateAfterText = result.duplicateRatingRowCountAfter
            ? `，仍有 ${result.duplicateRatingRowCountAfter} 条重复记录`
            : '';
          const storageTail = this.ratingStorageTail(result);
          const historyUserCount = result.activeHistoryUserCount || result.activeRatedUserCount || 0;
          this.$message.success(`已清理 ${result.deletedRowCount || 0} 条旧记录${duplicateText}，按 ${historyUserCount} 名有效历史用户修正 ${result.syncedUserCount || 0} 个缓存差异${tail}${duplicateAfterText}${storageTail}`);
          await this.fetchStats();
        } else {
          this.$message.error(res.data.message || '清理失败');
        }
      } catch (err) {
        this.$message.error('清理失败');
      } finally {
        this.cleaning = false;
      }
    },
    async syncRatingCache() {
      try {
        await ElMessageBox.confirm(
          '将按现有有效 Rating 历史重写用户当前 Rating 缓存，不会修改 Rating 历史记录。',
          '确认同步缓存',
          { type: 'warning', confirmButtonText: '同步', cancelButtonText: '取消' }
        );
      } catch (_) {
        return;
      }
      this.syncing = true;
      try {
        const res = await axios.post('/api/contest/syncContestRatingCache');
        if (res.status === 200) {
          const result = res.data.sync || {};
          const tail = result.ratingCacheMismatchAfter
            ? `，仍有 ${result.ratingCacheMismatchAfter} 个缓存差异`
            : '';
          const historyUserCount = result.activeHistoryUserCount || result.activeRatedUserCount || 0;
          this.$message.success(`已按 ${historyUserCount} 名有效历史用户修正 ${result.syncedUserCount || 0} 个缓存差异${tail}`);
          await this.fetchStats();
        } else {
          this.$message.error(res.data.message || '同步失败');
        }
      } catch (err) {
        this.$message.error('同步失败');
      } finally {
        this.syncing = false;
      }
    },
  },
  mounted() {
    this.fetchStats();
  },
};
</script>

<style scoped>
.rating-page {
  max-width: 1180px;
  margin: 18px auto;
  padding: 0 14px 30px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  justify-content: flex-end;
}

.limit-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #606266;
  font-size: 13px;
}

.limit-control :deep(.el-input-number) {
  width: 112px;
}

.eyebrow {
  color: #909399;
  font-size: 12px;
  font-weight: 700;
}

h1 {
  margin: 2px 0 0;
  color: #303133;
  font-size: 24px;
}

.policy-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
  color: #909399;
  font-size: 12px;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.metric,
.panel {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
}

.metric {
  padding: 14px 16px;
}

.metric-label,
.muted,
.result-item span {
  color: #909399;
}

.metric-label {
  font-size: 13px;
}

.metric-value {
  margin-top: 4px;
  color: #303133;
  font-size: 28px;
  font-weight: 800;
}

.metric-value.constraint-state {
  font-size: 18px;
}

.metric-sub {
  margin-top: 2px;
  color: #909399;
  font-size: 12px;
  word-break: break-word;
}

.metric.stale .metric-value {
  color: #E6A23C;
}

.stale-alert {
  margin-bottom: 14px;
}

.user-state-tag {
  margin-left: 6px;
}

.status-detail {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.4;
}

.panel {
  margin-top: 14px;
  padding: 16px;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  color: #303133;
  font-weight: 700;
}

.panel-title-note {
  color: #909399;
  font-size: 12px;
  font-weight: 400;
}

.contest-link {
  color: #409EFF;
  font-weight: 600;
  text-decoration: none;
}

.preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.rating-new {
  color: #303133;
  font-weight: 800;
}

.muted {
  margin-top: 2px;
  font-size: 12px;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}

.result-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
}

.result-item strong {
  color: #303133;
  font-size: 18px;
}

@media (max-width: 760px) {
  .page-head {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }

  .metrics-grid,
  .result-grid {
    grid-template-columns: 1fr 1fr;
  }

  .rating-page {
    padding-inline: 0;
  }

  .head-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .panel {
    padding: 12px;
  }

  .panel-title,
  .preview-head {
    align-items: flex-start;
    flex-wrap: wrap;
  }
}
</style>
