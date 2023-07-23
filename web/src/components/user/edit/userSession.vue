<template>
  <div style="margin: 0 20px;">
    <el-row>
      <el-col :span="20">
        <div class="header">
          在线会话
        </div>
      </el-col>
      <el-col :span="4">
        <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="下线所有会话?" @confirm="revokeAll">
          <template #reference>
            <el-button type="danger" plain>
              <el-icon class="el-icon--left">
                <SwitchButton />
              </el-icon>
              全部下线
            </el-button>
          </template>
        </el-popconfirm>
      </el-col>
    </el-row>
    <el-divider />
    <el-timeline style="margin-top:15px; padding: 0;">
      <el-timeline-item v-for="session in sessionList" :key="session.id" style="padding: 0;"
        :color="(session.lastact === '当前会话' ? '#0bbd87' : '')">
        <el-row>
          <el-col :span="21">
            <div>
              <span class="emphasis">{{ session.os }}</span> / <span class="attach">{{ session.browser }}</span>
            </div>
            <div style="margin: 5px 0; font-weight: 500; font-size: 15px;">
              <span v-if="session.lastact !== '当前会话'">上次操作于</span>
              {{ session.lastact }}
            </div>
            <div class="attach"> 登录于 {{ session.loginIp }} ( {{ session.loginLoc }} ) · {{ session.time }}</div>
          </el-col>
          <el-col :span="3">
            <div v-if="session.lastact !== '当前会话'">
              <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="下线该会话?"
                @confirm="revoke(session.token)">
                <template #reference>
                  <el-button style="margin-top: 20px;">
                    下线
                  </el-button>
                </template>
              </el-popconfirm>
            </div>
          </el-col>
        </el-row>
        <el-divider />
      </el-timeline-item>
    </el-timeline>
  </div>
</template>
<script>
import axios from "axios";
import { ElMessage } from "element-plus";

export default {
  name: "userSession",
  data() {
    return {
      sessionList: [],
    }
  },
  methods: {
    revoke(token) {
      axios.post('/api/user/revokeSession', { token: token }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '操作成功',
            type: 'success',
            duration: 1000,
          });
        } else {
          ElMessage({
            message: '操作失败' + res.data.message,
            type: 'error',
            duration: 3000,
          });
        }
        this.all();
      });
    },
    revokeAll() {
      axios.post('/api/user/revokeSession', { revokeAll: true }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '操作成功',
            type: 'success',
            duration: 1000,
          });
        } else {
          ElMessage({
            message: '操作失败' + res.data.message,
            type: 'error',
            duration: 3000,
          });
        }
        this.all();
      });
    },
    all() {
      axios.post('/api/user/listSessions').then(res => {
        this.sessionList = res.data.data;
      });
    }
  },
  mounted() {
    this.all();
  }
}
</script>

<style scoped>
.header {
  font-size: 24px;
  font-weight: 800;
}

.emphasis {
  font-size: 17px;
  font-weight: 600;
}

.attach {
  font-size: 14px;
  font-weight: 500;
  color: #7a7a7a;
}
</style>