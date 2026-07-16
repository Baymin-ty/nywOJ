<template>
  <el-row class="announcement-page">
    <el-col :span="24">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <p class="title">{{ announcementInfo.title }}</p>
            <p class="time">{{ announcementInfo.time }}</p>
            <el-button v-if="$can('announcement.manage')" type="danger" style="float: right;"
              @click="this.$router.push('/announcement/edit/' + announcementInfo.aid)">
              <el-icon class="el-icon--left">
                <Edit />
              </el-icon>
              编辑公告
            </el-button>
          </div>
        </template>
        <v-md-preview :text="announcementInfo.description"> </v-md-preview>
      </el-card>
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios';

export default {
  name: "announcementView",
  data() {
    return {
      aid: 0,
      announcementInfo: {},
    }
  },
  async mounted() {
    this.aid = this.$route.params.aid;
    await axios.post('/api/common/getAnnouncementInfo', { aid: this.aid }).then(res => {
      if (res.status === 200)
        this.announcementInfo = res.data.data
      else
        this.$message.error('获取公告失败');
    });
    document.title = "公告 — " + this.announcementInfo.title;
  }
}
</script>

<style scoped>
.announcement-page {
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
  font-size: 30px;
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

  .title {
    font-size: 22px;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .card-header {
    display: flex;
    align-items: center;
    flex-direction: column;
    gap: 8px;
  }

  :deep(.github-markdown-body) {
    padding: 4px 0;
    overflow-wrap: anywhere;
  }
}
</style>
