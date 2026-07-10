<template>
  <div class="discussion-view">
    <article class="discussion-article" v-loading="loading">
      <header class="article-head">
        <div class="article-kicker">
          <span>#{{ discussion.did || did }}</span>
          <el-tag :type="discussion.isPublic ? 'primary' : 'danger'" effect="plain">
            {{ discussion.isPublic ? '公开' : '隐藏' }}
          </el-tag>
        </div>
        <div class="article-title-row">
          <h1>{{ discussion.title }}</h1>
          <el-button-group v-if="discussion.canEdit" class="article-actions">
            <el-button type="primary" @click="this.$router.push('/discussion/edit/' + discussion.did)">
              <el-icon class="el-icon--left"><Edit /></el-icon>
              编辑
            </el-button>
            <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认删除讨论?" @confirm="delDiscussion">
              <template #reference>
                <el-button type="danger">
                  <el-icon class="el-icon--left"><Delete /></el-icon>
                  删除
                </el-button>
              </template>
            </el-popconfirm>
          </el-button-group>
        </div>
        <div class="meta-grid">
          <div class="meta-item">
            <span>发布者</span>
            <router-link class="rlink" :to="'/user/' + discussion.uid">{{ discussion.publisher }}</router-link>
          </div>
          <div class="meta-item">
            <span>发布时间</span>
            <strong>{{ discussion.time || '-' }}</strong>
          </div>
          <div class="meta-item">
            <span>更新</span>
            <strong>{{ discussion.updateTime || '-' }}</strong>
          </div>
          <div v-if="discussion.pid" class="meta-item problem-meta">
            <span>题目</span>
            <router-link class="rlink" :to="'/problem/' + discussion.pid">
              #{{ discussion.pid }} {{ discussion.problemTitle || '' }}
            </router-link>
          </div>
        </div>
      </header>

      <section class="article-body">
        <v-md-preview :text="discussion.content || ''" />
      </section>

      <div v-if="discussion.did" class="reaction-bar">
        <el-button
          v-for="item in reactionDefs"
          :key="'discussion-' + item.key"
          class="reaction-button"
          size="small"
          :plain="!reactionActive(discussion, item.key)"
          :type="reactionActive(discussion, item.key) ? 'primary' : ''"
          :loading="reactionLoading['discussion:' + discussion.did + ':' + item.key]"
          @click="toggleReaction('discussion', discussion.did, item.key)"
        >
          {{ item.label }}
          <span class="reaction-count">{{ reactionCount(discussion, item.key) }}</span>
        </el-button>
      </div>
    </article>

    <section class="reply-panel">
      <div class="reply-head">
        <div class="reply-title-wrap">
          <span class="reply-title">回复</span>
          <span class="reply-count-pill">{{ total }} 条</span>
        </div>
        <el-pagination
          v-if="total > 30"
          @current-change="handleCurrentChange"
          :current-page="currentPage"
          :page-size="30"
          layout="prev, pager, next"
          :total="total"
        />
      </div>

      <el-empty v-if="!replies.length" description="暂无回复" />

      <article v-for="reply in replies" :key="reply.rid" class="reply">
        <div class="reply-avatar">{{ avatarLetter(reply.publisher) }}</div>
        <div class="reply-content">
          <div class="reply-meta">
            <div class="reply-author">
              <router-link class="rlink" :to="'/user/' + reply.uid">{{ reply.publisher }}</router-link>
              <el-tag v-if="!reply.isPublic" type="danger" size="small" effect="plain">隐藏</el-tag>
            </div>
            <span>{{ reply.time }}</span>
            <span class="spacer"></span>
            <template v-if="reply.canEdit">
              <el-button link type="primary" @click="startEditReply(reply)">编辑</el-button>
              <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认删除回复?" @confirm="delReply(reply.rid)">
                <template #reference>
                  <el-button link type="danger">删除</el-button>
                </template>
              </el-popconfirm>
            </template>
          </div>
          <div v-if="editingRid === reply.rid" class="reply-edit">
            <el-input v-model="editingContent" type="textarea" :rows="6" />
            <div class="reply-actions">
              <el-switch v-model="editingPublic" active-text="公开" inactive-text="隐藏" />
              <el-button type="primary" @click="updateReply(reply.rid)">保存</el-button>
              <el-button @click="cancelEditReply">取消</el-button>
            </div>
          </div>
          <v-md-preview v-else :text="reply.content || ''" />
          <div class="reaction-bar reply-reactions">
            <el-button
              v-for="item in reactionDefs"
              :key="'reply-' + reply.rid + '-' + item.key"
              class="reaction-button"
              size="small"
              :plain="!reactionActive(reply, item.key)"
              :type="reactionActive(reply, item.key) ? 'primary' : ''"
              :loading="reactionLoading['reply:' + reply.rid + ':' + item.key]"
              @click="toggleReaction('reply', reply.rid, item.key)"
            >
              {{ item.label }}
              <span class="reaction-count">{{ reactionCount(reply, item.key) }}</span>
            </el-button>
          </div>
        </div>
      </article>

      <div class="reply-composer">
        <div v-if="$store.state.uid && discussion.canReply" class="new-reply">
          <el-input v-model="replyText" type="textarea" :rows="6" placeholder="写下你的回复" />
          <div class="reply-submit">
            <el-button type="primary" :loading="replyLoading" @click="addReply">
              <el-icon class="el-icon--left"><DocumentAdd /></el-icon>
              回复
            </el-button>
          </div>
        </div>
        <div v-else-if="$store.state.uid" class="empty">无权限回复本讨论</div>
        <div v-else class="empty">
          <router-link class="rlink" to="/user/login">登录后回复</router-link>
        </div>
      </div>
    </section>
  </div>
</template>

<script>
import axios from 'axios';

export default {
  name: 'discussionView',
  data() {
    return {
      did: 0,
      discussion: {},
      replies: [],
      total: 0,
      currentPage: 1,
      loading: false,
      replyLoading: false,
      replyText: '',
      editingRid: 0,
      editingContent: '',
      editingPublic: true,
      reactionDefs: [
        { key: 'like', label: '赞' },
        { key: 'helpful', label: '有用' },
        { key: 'thanks', label: '感谢' },
        { key: 'wow', label: '惊讶' },
      ],
      reactionLoading: {},
    }
  },
  methods: {
    async all() {
      this.loading = true;
      try {
        const res = await axios.post('/api/discussion/getDiscussion', { did: this.did });
        if (res.status === 200) {
          this.discussion = res.data.data;
          document.title = '讨论 — ' + this.discussion.title;
        } else {
          this.$message.error(res.data.message);
          this.$router.push('/discussion');
        }
      } finally {
        this.loading = false;
      }
    },
    loadReplies() {
      axios.post('/api/discussion/getReplies', { did: this.did, pageId: this.currentPage, pageSize: 30 }).then(res => {
        if (res.status === 200) {
          this.replies = res.data.data || [];
          this.total = res.data.total || 0;
        } else {
          this.$message.error(res.data.message);
        }
      });
    },
    handleCurrentChange(val) {
      this.currentPage = val;
      this.loadReplies();
    },
    addReply() {
      if (!this.replyText.trim()) {
        this.$message.error('回复不能为空');
        return;
      }
      this.replyLoading = true;
      axios.post('/api/discussion/addReply', { did: this.did, content: this.replyText }).then(res => {
        if (res.status === 200) {
          this.replyText = '';
          this.$message.success('回复成功');
          this.all();
          this.loadReplies();
        } else {
          this.$message.error(res.data.message);
        }
      }).finally(() => {
        this.replyLoading = false;
      });
    },
    delDiscussion() {
      axios.post('/api/discussion/delDiscussion', { did: this.did }).then(res => {
        if (res.status === 200) {
          this.$message.success('删除成功');
          this.$router.push('/discussion');
        } else {
          this.$message.error(res.data.message);
        }
      });
    },
    startEditReply(reply) {
      this.editingRid = reply.rid;
      this.editingContent = reply.content;
      this.editingPublic = !!reply.isPublic;
    },
    cancelEditReply() {
      this.editingRid = 0;
      this.editingContent = '';
      this.editingPublic = true;
    },
    updateReply(rid) {
      axios.post('/api/discussion/updateReply', {
        reply: { rid, content: this.editingContent, isPublic: this.editingPublic }
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('回复已更新');
          this.cancelEditReply();
          this.loadReplies();
        } else {
          this.$message.error(res.data.message);
        }
      });
    },
    delReply(rid) {
      axios.post('/api/discussion/delReply', { rid }).then(res => {
        if (res.status === 200) {
          this.$message.success('回复已删除');
          this.all();
          this.loadReplies();
        } else {
          this.$message.error(res.data.message);
        }
      });
    },
    avatarLetter(name) {
      return (name || '?').trim().slice(0, 1).toUpperCase();
    },
    reactionCount(target, key) {
      const item = ((target && target.reactions) || []).find(reaction => reaction.key === key);
      return item ? Number(item.count) || 0 : 0;
    },
    reactionActive(target, key) {
      const item = ((target && target.reactions) || []).find(reaction => reaction.key === key);
      return !!(item && item.mine);
    },
    ensureReaction(target, key) {
      if (!target.reactions) {
        target.reactions = this.reactionDefs.map(item => ({ key: item.key, count: 0, mine: false }));
      }
      let item = target.reactions.find(reaction => reaction.key === key);
      if (!item) {
        item = { key, count: 0, mine: false };
        target.reactions.push(item);
      }
      return item;
    },
    reactionTarget(targetType, id) {
      if (targetType === 'discussion') return this.discussion;
      return this.replies.find(reply => reply.rid === id);
    },
    applyReactionLocal(target, key, selected) {
      if (!target) return;
      const item = this.ensureReaction(target, key);
      if (!!item.mine === selected) return;
      item.mine = selected;
      item.count = Math.max(0, (Number(item.count) || 0) + (selected ? 1 : -1));
    },
    async toggleReaction(targetType, id, key) {
      if (!this.$store.state.uid) {
        this.$message.error('请先登录');
        this.$router.push('/user/login');
        return;
      }
      const target = this.reactionTarget(targetType, id);
      if (!target) return;
      const selected = !this.reactionActive(target, key);
      const loadingKey = `${targetType}:${id}:${key}`;
      if (this.reactionLoading[loadingKey]) return;
      this.reactionLoading = { ...this.reactionLoading, [loadingKey]: true };
      try {
        const res = await axios.post('/api/discussion/toggleReaction', {
          targetType,
          id,
          reaction: key,
          selected,
        });
        if (res.status === 200) {
          this.applyReactionLocal(target, key, !!res.data.selected);
        } else {
          this.$message.error(res.data.message);
        }
      } finally {
        const reactionLoading = { ...this.reactionLoading };
        delete reactionLoading[loadingKey];
        this.reactionLoading = reactionLoading;
      }
    },
  },
  async mounted() {
    this.did = parseInt(this.$route.params.did, 10);
    await this.all();
    this.loadReplies();
  }
}
</script>

<style scoped>
.discussion-view {
  margin: 0 auto;
  max-width: 1080px;
}

.discussion-article,
.reply-panel {
  border: 1px solid #ebeef5;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04);
  text-align: left;
}

.discussion-article {
  overflow: hidden;
}

.article-head {
  padding: 18px 22px 16px;
  border-bottom: 1px solid #ebeef5;
  background: #ffffff;
}

.article-kicker,
.article-title-row,
.reply-head,
.reply-title-wrap,
.reply-meta,
.reply-actions,
.reply-author {
  display: flex;
  align-items: center;
  gap: 10px;
}

.article-kicker {
  margin-bottom: 8px;
  color: #909399;
  font-size: 12px;
  font-weight: 700;
}

.article-title-row,
.reply-head {
  justify-content: space-between;
  align-items: flex-start;
}

.article-title-row h1 {
  min-width: 0;
  margin: 0;
  color: #303133;
  font-size: 24px;
  line-height: 1.4;
  letter-spacing: 0;
}

.article-actions {
  flex-shrink: 0;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.meta-item {
  min-width: 0;
  padding: 9px 11px;
  border: 1px solid #eef2f7;
  border-radius: 8px;
  background: #f8fafc;
}

.meta-item span,
.meta-item strong,
.meta-item a {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-item span {
  margin-bottom: 3px;
  color: #909399;
  font-size: 12px;
}

.meta-item strong,
.meta-item a {
  color: #303133;
  font-size: 13px;
  font-weight: 600;
}

.article-body {
  padding: 20px 22px;
}

.article-body :deep(.v-md-editor-preview),
.reply-content :deep(.v-md-editor-preview) {
  color: #263244;
  line-height: 1.8;
}

.reply-panel {
  margin-top: 14px;
  overflow: hidden;
}

.reply-head {
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid #ebeef5;
  background: #ffffff;
}

.reply-title-wrap {
  align-items: baseline;
}

.reply-title {
  color: #303133;
  font-size: 17px;
  font-weight: 800;
  white-space: nowrap;
}

.reply-count-pill {
  padding: 2px 10px;
  border-radius: 999px;
  background: #f4f4f5;
  color: #909399;
  font-size: 12px;
  white-space: nowrap;
}

.reply {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 14px;
  padding: 18px;
  border-bottom: 1px solid #ebeef5;
}

.reply:last-of-type {
  border-bottom: 0;
}

.reply-avatar {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 8px;
  background: #ecf5ff;
  color: #409eff;
  font-weight: 800;
}

.reply-content {
  min-width: 0;
}

.reply-meta {
  color: #909399;
  font-size: 13px;
  margin-bottom: 8px;
}

.reply-author {
  min-width: 0;
  font-weight: 700;
}

.reply-author .rlink {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spacer {
  flex: 1;
}

.empty {
  color: #909399;
  padding: 28px 0;
  text-align: center;
}

.reply-edit {
  margin-top: 8px;
}

.reply-actions {
  justify-content: flex-end;
  margin-top: 8px;
}

.reaction-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  min-height: 32px;
  padding: 0 22px 20px;
}

.reaction-bar :deep(.el-button + .el-button) {
  margin-left: 0;
}

.reaction-button {
  min-width: 72px;
}

.reaction-count {
  display: inline-block;
  min-width: 1ch;
  margin-left: 4px;
  text-align: left;
}

.reply-reactions {
  margin-top: 10px;
  padding: 0;
}

.reply-composer {
  padding: 18px;
  background: #ffffff;
}

.reply-submit {
  text-align: right;
  margin-top: 10px;
}

@media (max-width: 768px) {
  .discussion-view {
    width: 100%;
  }

  .article-head,
  .article-body,
  .reaction-bar,
  .reply-head,
  .reply,
  .reply-composer {
    padding-left: 15px;
    padding-right: 15px;
  }

  .article-title-row,
  .reply-head,
  .reply-meta {
    align-items: stretch;
    flex-direction: column;
  }

  .article-title-row h1 {
    font-size: 21px;
  }

  .article-actions {
    width: 100%;
  }

  .meta-grid {
    grid-template-columns: 1fr;
  }

  .reply {
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 10px;
  }

  .reply-avatar {
    width: 34px;
    height: 34px;
  }

  .reply-actions {
    justify-content: flex-start;
  }
}
</style>
