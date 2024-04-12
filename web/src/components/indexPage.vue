<template>
  <el-row style="margin: auto;max-width: 1500px;">
    <el-col :xs="24" :sm="24" :md="16">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            公告栏
            <el-popconfirm v-if="gid === 3" confirm-button-text="确认" cancel-button-text="取消" title="确认添加公告?"
              @confirm="addAnnouncement">
              <template #reference>
                <el-button type="danger">
                  <el-icon class="el-icon--left">
                    <Plus />
                  </el-icon>
                  添加公告
                </el-button>
              </template>
            </el-popconfirm>
          </div>
        </template>
        <el-table :data="announcements" v-loading="!announcements.length">
          <el-table-column prop="title" label="标题" min-width="60%">
            <template #default="scope">
              <span class="rlink" @click="this.$router.push('/announcement/' + scope.row.aid)"> {{
                scope.row.title
                }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="time" label="发布时间" min-width="40%" />
        </el-table>
      </el-card>
      <cuteRank />
    </el-col>
    <el-col :xs="24" :sm="24" :md="8">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            一言（ヒトコト）
            <el-button type="primary" @click="updateHitokoto" color="#626aef" plain>
              <el-icon class="el-icon--left">
                <Refresh />
              </el-icon>
              再来一个
            </el-button>
          </div>
        </template>
        <div style="font-size: 14px; "> {{ motto.hitokoto }} </div>
        <div style="font-size: 12px; color: grey; float: right;margin: 10px;"> from {{ motto.from }} </div>
      </el-card>
      <rabbitData />
    </el-col>
  </el-row>
</template>

<script>
import axios from "axios";
import cuteRank from '@/components/rabbit/cuteRankList.vue'
import rabbitData from '@/components/rabbit/rabbitClickData.vue'
import { ElMessage } from 'element-plus'

export default {
  name: "myHeader",
  components: {
    rabbitData,
    cuteRank,
  },
  data() {
    return {
      motto: {},
      announcements: [],
      gid: 0,
    }
  },
  methods: {
    updateHitokoto() {
      axios.post('https://v1.hitokoto.cn/?c=a').then(res => {
        if (res.status === 200)
          this.motto = res.data
        else {
          this.motto.hitokoto = "加载一言时发生错误。";
          this.motto.from = "/";
        }
      }).catch(() => {
        this.motto.hitokoto = "加载一言时发生错误。";
        this.motto.from = "/";
      });
    },
    getAnnouncements() {
      axios.post('/api/common/getAnnouncementList').then(res => {
        this.announcements = res.data.data;
      });
    },
    addAnnouncement() {
      axios.post('/api/admin/addAnnouncement').then(res => {
        if (res.status === 200) {
          this.$router.push('/announcement/edit/' + res.data.aid);
        } else {
          ElMessage({
            message: '添加公告失败' + res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
      });
    }
  },
  mounted() {
    this.gid = this.$store.state.gid;
    this.updateHitokoto();
    this.getAnnouncements();
  },
}
</script>

<style scoped>
.box-card {
  margin: 10px;
  text-align: center;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
  font-weight: bolder;
}
</style>
