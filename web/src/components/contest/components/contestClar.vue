<template>
  <div class="clar-panel">
    <!-- 管理员：发公告 -->
    <div v-if="canManage" class="clar-admin-bar">
      <el-input v-model="announcement" type="textarea" :rows="2" maxlength="4000"
        placeholder="发布全场公告（所有参赛者可见并收到通知）" />
      <el-button type="primary" :disabled="!announcement.trim()" :loading="posting" @click="postAnnouncement">发公告</el-button>
    </div>

    <!-- 选手：提问 -->
    <div v-else-if="canAsk" class="clar-ask-bar">
      <el-select v-if="problems.length" v-model="askPid" placeholder="关联题目（可选）" clearable size="default" class="clar-pid">
        <el-option v-for="p in problems" :key="p.idx" :label="`${letter(p.idx)}. ${p.title}`" :value="p.pid" />
      </el-select>
      <el-input v-model="question" type="textarea" :rows="2" maxlength="2000" placeholder="向管理员提问…" />
      <el-button type="primary" :disabled="!question.trim()" :loading="asking" @click="submitClar">提交提问</el-button>
    </div>
    <el-alert v-else type="info" :closable="false" title="仅参赛者可在比赛进行中提问" />

    <el-divider />

    <el-empty v-if="!clars.length" description="暂无提问 / 公告" />
    <div v-for="c in clars" :key="c.clarId" class="clar-item" :class="{ announce: isAnnouncement(c) }">
      <div class="clar-q">
        <el-tag v-if="isAnnouncement(c)" type="warning" size="small" effect="dark">公告</el-tag>
        <el-tag v-else-if="c.isPublic" type="success" size="small" effect="plain">公开</el-tag>
        <el-tag v-else size="small" effect="plain">私密</el-tag>
        <span v-if="canManage && c.askerName" class="clar-asker">{{ c.askerName }}</span>
        <span v-if="!isAnnouncement(c)" class="clar-qtext">{{ c.question }}</span>
      </div>
      <div v-if="c.answer" class="clar-a">
        <el-icon><ChatLineRound /></el-icon> {{ c.answer }}
      </div>
      <!-- 管理员：未回复的行内回复 -->
      <div v-if="canManage && !isAnnouncement(c)" class="clar-answer-bar">
        <el-input v-model="replyDraft[c.clarId]" size="small" :placeholder="c.answer ? '修改回复…' : '回复…'" />
        <el-checkbox v-model="replyPublic[c.clarId]">公开</el-checkbox>
        <el-button size="small" type="primary" :disabled="!(replyDraft[c.clarId] || '').trim()" @click="answer(c)">发送</el-button>
      </div>
    </div>
  </div>
</template>

<script>
import axios from "axios";

export default {
  name: "contestClar",
  props: {
    canManage: { type: Boolean, default: false },
    canAsk: { type: Boolean, default: false },
    problems: { type: Array, default: () => [] },
  },
  data() {
    return {
      cid: 0,
      clars: [],
      question: "",
      askPid: null,
      announcement: "",
      asking: false,
      posting: false,
      replyDraft: {},
      replyPublic: {},
      timer: null,
    };
  },
  mounted() {
    this.cid = this.$route.params.cid;
    this.load();
    this.timer = setInterval(() => this.load(), 60000);
  },
  beforeUnmount() {
    if (this.timer) clearInterval(this.timer);
  },
  methods: {
    letter(idx) {
      return String.fromCharCode(64 + Number(idx));
    },
    isAnnouncement(c) {
      return (!c.question || c.question === "") && c.isPublic;
    },
    load() {
      axios.post("/api/contest/listClars", { cid: this.cid }).then((res) => {
        if (res.data) this.clars = res.data.data || [];
      }).catch(() => {});
    },
    submitClar() {
      this.asking = true;
      axios.post("/api/contest/submitClar", { cid: this.cid, question: this.question, pid: this.askPid })
        .then(() => {
          this.$message.success("提问已提交");
          this.question = "";
          this.askPid = null;
          this.load();
        })
        .catch((e) => { this.$message.error((e.response && e.response.data && e.response.data.message) || "提交失败"); })
        .finally(() => { this.asking = false; });
    },
    answer(c) {
      const text = (this.replyDraft[c.clarId] || "").trim();
      if (!text) return;
      axios.post("/api/contest/answerClar", { clarId: c.clarId, answer: text, isPublic: !!this.replyPublic[c.clarId] })
        .then(() => {
          this.$message.success("已回复");
          this.replyDraft[c.clarId] = "";
          this.load();
        })
        .catch(() => this.$message.error("回复失败"));
    },
    postAnnouncement() {
      this.posting = true;
      axios.post("/api/contest/postAnnouncement", { cid: this.cid, content: this.announcement })
        .then(() => {
          this.$message.success("公告已发布");
          this.announcement = "";
          this.load();
        })
        .catch(() => this.$message.error("发布失败"))
        .finally(() => { this.posting = false; });
    },
  },
};
</script>

<style scoped>
.clar-admin-bar,
.clar-ask-bar {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.clar-pid {
  width: 200px;
}
.clar-admin-bar .el-textarea,
.clar-ask-bar .el-textarea {
  flex: 1;
  min-width: 240px;
}
.clar-item {
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.clar-item.announce {
  background: var(--el-color-warning-light-9);
  border-radius: 6px;
}
.clar-q {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.clar-asker {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.clar-qtext {
  font-weight: 500;
}
.clar-a {
  margin: 6px 0 0 4px;
  color: var(--el-color-primary);
  display: flex;
  gap: 4px;
  align-items: baseline;
}
.clar-answer-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}
.clar-answer-bar .el-input {
  max-width: 400px;
}
</style>
