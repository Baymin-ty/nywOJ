<template>
  <el-row style="margin: auto;max-width: 1500px;min-width: 600px;">
    <el-col :span="24">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <p class="title">
              标题：<el-input v-model="announcementInfo.title" style="width: 200px;" />
              权重：<el-input v-model="announcementInfo.weight" style="width: 80px;" />
            </p>
            <p class="time">{{ announcementInfo.time }}</p>
            <el-button-group style="float: right;">
              <el-button type="danger" @click="updateAnnouncement">更新公告</el-button>
              <el-button type="primary"
                @click="this.$router.push('/announcement/' + announcementInfo.aid)">返回公告</el-button>
            </el-button-group>
          </div>
        </template>
        <v-md-editor height="600px" v-model="announcementInfo.description"></v-md-editor>
      </el-card>
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios';
import { ElMessage } from 'element-plus'

export default {
  name: "announcementView",
  data() {
    return {
      aid: 0,
      gid: 1,
      announcementInfo: {},
    }
  },
  methods: {
    updateAnnouncement() {
      axios.post('/api/admin/updateAnnouncement', {
        aid: this.announcementInfo.aid,
        info: this.announcementInfo
      }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '更新公告成功',
            type: 'success',
            duration: 1000,
          });
        }
        else {
          ElMessage({
            message: res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
        this.all();
      })
    },
    all() {
      axios.post('/api/common/getAnnouncementInfo', { aid: this.aid }).then(res => {
        if (res.status === 200) {
          this.announcementInfo = res.data.data
        }
        else {
          this.$router.push({ path: '/' });
        }
      });
    }
  },
  mounted() {
    if (this.$store.state.gid < 3) {
      this.$router.push('/');
      return;
    }
    this.aid = this.$route.params.aid;
    this.all();
    document.title = "编辑公告";
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