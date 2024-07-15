<template>
  <el-row style="margin: auto;max-width: 1500px;min-width: 600px;">
    <el-col :span="24">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <p class="title">
              {{ paste.title }}
              <el-tag :type="paste.isPublic ? 'primary' : 'danger'">{{ paste.isPublic ? '公开' : '私有' }}</el-tag>
            </p>
            <div class="subtitle">
              <span>
                发布者: <router-link class="rlink" :to="'/user/' + paste.uid">{{ paste.paster }}</router-link>
              </span>
              <span style="margin-left: 10px;">
                更改时间: <span class="time"> {{ paste.time }}</span>
              </span>
            </div>
            <div style="float: right;">
              <el-button-group v-if="this.gid === 3 || this.$store.state.uid === paste.uid" style="">
                <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认删除剪贴板?" @confirm="delPaste">
                  <template #reference>
                    <el-button type="warning">
                      <el-icon class="el-icon--left">
                        <Delete />
                      </el-icon>
                      删除剪贴板
                    </el-button>
                  </template>
                </el-popconfirm>
                <el-button type="danger" style="float: right;" @click="this.$router.push('/paste/edit/' + paste.mark)">
                  <el-icon class="el-icon--left">
                    <Edit />
                  </el-icon>
                  编辑剪贴板
                </el-button>
              </el-button-group>
            </div>
          </div>
        </template>
        <v-md-preview :text="paste.content"> </v-md-preview>
      </el-card>
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios';
import { ElMessage } from 'element-plus'

export default {
  name: "pasteView",
  data() {
    return {
      mark: '',
      gid: 1,
      paste: {},
    }
  },
  methods: {
    async all() {
      await axios.post('/api/common/getPaste', { mark: this.mark }).then(res => {
        if (res.status === 200) {
          this.paste = res.data.data
        }
        else {
          ElMessage({
            message: '获取剪贴板失败' + res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
      });
      document.title = "剪贴板 — " + this.paste.title;
    },
    delPaste() {
      axios.post('/api/common/delPaste', { mark: this.mark }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '删除成功',
            type: 'success',
          });
          this.$router.push('/paste');
        } else {
          ElMessage({
            message: '删除失败' + res.data.message,
            type: 'error',
            duration: 2000
          });
        }
      });
    }
  },
  async mounted() {
    this.mark = this.$route.params.mark;
    this.gid = this.$store.state.gid;
    this.all();
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
  font-size: 30px;
}

.subtitle {
  text-align: center;
  padding: 8px;
}

.time {
  font-size: 12px;
  color: #708090;
}
</style>