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
                发布者: <span class="rlink" @click="this.$router.push('/user/' + paste.uid)">{{ paste.paster }}</span>
              </span>
              <span style="margin-left: 10px;">
                时间: <span class="time"> {{ paste.time }}</span>
              </span>
            </div>
            <el-button v-if="this.gid === 3 || this.$store.state.uid === paste.uid" type="danger" style="float: right;"
              @click="this.$router.push('/paste/edit/' + paste.mark)">
              <el-icon class="el-icon--left">
                <Edit />
              </el-icon>
              编辑剪贴板
            </el-button>
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
  async mounted() {
    this.mark = this.$route.params.mark;
    this.gid = this.$store.state.gid;
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