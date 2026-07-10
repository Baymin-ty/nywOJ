<template>
  <div class="discussion-edit">
    <section class="editor-panel" v-loading="loading">
      <div class="sub-header">
        <div class="sub-title-wrap">
          <span class="sub-title">编辑讨论</span>
        </div>
        <el-button-group class="head-actions">
          <el-button type="primary" @click="updateDiscussion">
            <el-icon class="el-icon--left">
              <Check />
            </el-icon>
            保存
          </el-button>
          <el-button @click="$router.push('/discussion/' + did)">
            <el-icon class="el-icon--left">
              <Back />
            </el-icon>
            返回
          </el-button>
        </el-button-group>
      </div>

      <el-form label-position="top" class="form">
        <el-form-item label="标题" class="title-field">
          <el-input v-model="discussion.title" maxlength="80" show-word-limit placeholder="讨论标题" />
        </el-form-item>
        <el-form-item label="关联题目" class="compact-field">
          <el-input v-model="pidText" placeholder="留空表示全站讨论" />
        </el-form-item>
        <el-form-item label="可见性" class="visibility-field">
          <el-switch v-model="discussion.isPublic" active-text="公开" inactive-text="隐藏" />
        </el-form-item>
      </el-form>

      <div class="editor-shell">
        <v-md-editor
          height="620px"
          left-toolbar="undo redo clear | h bold italic strikethrough quote | ul ol table hr | link image code"
          v-model="discussion.content"
        />
      </div>
    </section>
  </div>
</template>

<script>
import axios from 'axios';

export default {
  name: 'discussionEdit',
  data() {
    return {
      did: 0,
      discussion: {},
      pidText: '',
      loading: false,
    }
  },
  methods: {
    all() {
      this.loading = true;
      axios.post('/api/discussion/getDiscussion', { did: this.did }).then(res => {
        if (res.status === 200) {
          this.discussion = res.data.data;
          this.discussion.isPublic = !!this.discussion.isPublic;
          this.pidText = this.discussion.pid ? String(this.discussion.pid) : '';
          if (!this.discussion.canEdit) {
            this.$message.error('无权限编辑该讨论');
            this.$router.push('/discussion/' + this.did);
          }
        } else {
          this.$message.error(res.data.message);
          this.$router.push('/discussion');
        }
      }).finally(() => {
        this.loading = false;
      });
    },
    updateDiscussion() {
      const title = (this.discussion.title || '').trim();
      const content = (this.discussion.content || '').trim();
      if (!title) {
        this.$message.error('标题不能为空');
        return;
      }
      if (!content) {
        this.$message.error('内容不能为空');
        return;
      }
      const pid = this.pidText ? parseInt(this.pidText, 10) : null;
      if (this.pidText && (!pid || pid < 1)) {
        this.$message.error('题目 ID 无效');
        return;
      }
      axios.post('/api/discussion/updateDiscussion', {
        discussion: {
          did: this.did,
          pid,
          title,
          content,
          isPublic: this.discussion.isPublic,
        }
      }).then(res => {
        if (res.status === 200 && !res.data.error) {
          this.$message.success('讨论已更新');
          this.$router.push('/discussion/' + this.did);
        } else {
          this.$message.error(res.data.message || res.data.error || '保存失败');
        }
      });
    },
  },
  mounted() {
    this.did = parseInt(this.$route.params.did, 10);
    this.all();
    document.title = '编辑讨论';
  }
}
</script>

<style scoped>
.discussion-edit {
  margin: 0 auto;
  max-width: 1160px;
}

.editor-panel {
  padding: 18px;
  border: 1px solid #ebeef5;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04);
  text-align: left;
}

.sub-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.sub-title-wrap {
  display: inline-flex;
  align-items: baseline;
  gap: 10px;
}

.sub-title {
  color: #303133;
  font-size: 17px;
  font-weight: 800;
  white-space: nowrap;
}

.head-actions {
  flex-shrink: 0;
  flex-wrap: wrap;
}

.form {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 220px 180px;
  gap: 14px;
  align-items: end;
}

.form :deep(.el-form-item) {
  margin-bottom: 12px;
}

.form :deep(.el-form-item__label) {
  padding-bottom: 6px;
  color: #536173;
  font-weight: 700;
}

.editor-shell {
  overflow: hidden;
  border: 1px solid #ebeef5;
  border-radius: 10px;
}

.editor-shell :deep(.v-md-editor) {
  box-shadow: none;
}

@media (max-width: 768px) {
  .discussion-edit {
    width: 100%;
  }

  .head-actions {
    width: 100%;
  }

  .editor-panel {
    padding: 14px;
  }

  .form {
    grid-template-columns: 1fr;
  }
}
</style>
