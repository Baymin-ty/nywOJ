<template>
  <el-row style="margin: auto;max-width: 1500px;min-width: 600px;">
    <el-col :span="24">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <p class="title">
              标题：<el-input v-model="paste.title" style="width: 200px; margin-right: 20px;" />
              <el-switch :disabled="!($store.state.gid > 2 || $store.state.uid === paste.uid)" v-model="paste.isPublic" size="large" active-text="公开" inactive-text="私有" />
            </p>
            <el-button-group style="float: right;">
              <el-button v-if="$store.state.gid > 2 || $store.state.uid === paste.uid" type="danger"
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
</style>