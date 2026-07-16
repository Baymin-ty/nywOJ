<template>
  <el-row class="paste-page">
    <el-col :span="24">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <p class="title">
              标题：<el-input v-model="paste.title" style="width: 200px; margin-right: 20px;" />
              <el-switch :disabled="!($can('paste.edit.any') || $store.state.uid === paste.uid)" v-model="paste.isPublic" size="large" active-text="公开" inactive-text="私有" />
            </p>
            <el-button-group style="float: right;">
              <el-button v-if="$can('paste.edit.any') || $store.state.uid === paste.uid" type="danger"
                @click="updatePaste">更新剪贴板</el-button>
              <el-button type="primary" @click="this.$router.push('/paste/' + paste.mark)">返回剪贴板</el-button>
            </el-button-group>
          </div>
        </template>
        <v-md-editor height="600px"
          left-toolbar="undo redo clear | h bold italic strikethrough quote | ul ol table hr | link image code"
          v-model="paste.content"></v-md-editor>
      </el-card>
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios';

export default {
  name: "pasteEdit",
  data() {
    return {
      mark: '',
      paste: {},
    }
  },
  methods: {
    updatePaste() {
      if (!this.paste?.mark) return;
      axios.post('/api/common/updatePaste', {
        mark: this.paste.mark,
        paste: this.paste
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('更新剪贴板成功');
        }
        else {
          this.$message.error(res.data.message);
        }
        this.all();
      })
    },
    all() {
      axios.post('/api/common/getPaste', { mark: this.mark }).then(res => {
        if (res.status === 200) {
          this.paste = res.data.data
          this.paste.isPublic = !!this.paste.isPublic
        }
        else {
          this.$message.error('无法编辑剪贴板' + res.data.message);
        }
      });
    }
  },
  mounted() {
    this.mark = this.$route.params.mark;
    this.all();
    document.title = "编辑剪贴板";
  }
}
</script>

<style scoped>
.paste-page {
  margin: auto;
  max-width: 1500px;
  min-width: 0;
}

.box-card {
  margin: 10px;
  text-align: left;
}

.title {
  text-align: center;
  margin: 5px;
  font-size: 15px;
}

.time {
  text-align: center;
  margin: 0;
  font-size: 12px;
  color: #708090;
}

@media (max-width: 768px) {
  .box-card {
    margin: 0;
  }

  .card-header,
  .title {
    display: flex;
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }

  .title :deep(.el-input) {
    width: 100% !important;
    margin-right: 0 !important;
  }

  .card-header :deep(.el-button-group) {
    display: flex;
    float: none !important;
    width: 100%;
  }

  .card-header :deep(.el-button-group .el-button) {
    flex: 1;
  }

  :deep(.v-md-editor) {
    min-width: 0;
  }
}
</style>
