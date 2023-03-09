<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1200px">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          用户管理
          <el-pagination @current-change="handleCurrentChange" :current-page="currentPage" :page-size="20"
            layout="total, prev, pager, next" :total="total"></el-pagination>
          <el-button type="primary" @click="all">刷新</el-button>
        </div>
      </template>
      <el-table :data="info" height="600px" :cell-style="{ textAlign: 'center' }"
        :header-cell-style="{ textAlign: 'center' }">
        <el-table-column prop="uid" label="uid" width="80px" />
        <el-table-column prop="name" label="用户名" width="150px">
          <template #default="scope">
            <span style="cursor: pointer;" v-show="!scope.row.edit" @click="this.$router.push('/user/' + scope.row.uid)">
              {{ scope.row.name }}</span>
            <el-input v-show="scope.row.edit" size="small" style="width:150px" v-model="this.tempInfo.name" />
          </template>
        </el-table-column>
        <el-table-column prop="email" label="邮箱" width="300px">
          <template #default="scope">
            <span v-show="!scope.row.edit"> {{ scope.row.email }} </span>
            <el-input v-show="scope.row.edit" size="small" style="width:200px" v-model="this.tempInfo.email" />
          </template>
        </el-table-column>
        <el-table-column prop="gid" label="用户组" width="140px">
          <template #default="scope">
            <span v-show="!scope.row.edit"> {{ group[scope.row.gid] }}</span>
            <el-select v-show="scope.row.edit" v-model="this.tempInfo.gid" size="small" style="width: 100px">
              <el-option v-for="item in options" :key="item.value" :label="item.label" :value="item.value"
                style="width: 100px; font-size: 12px; padding-left: 10px; padding-right: 10px;" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column prop="inUse" label="状态" width="auto">
          <template #default="scope">
            <span> {{ scope.row.inUse ? "正常" : "封禁" }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="250px">
          <template #default="scope">
            <span>
              <el-button size="small" :type="scope.row.edit ? 'warning' : 'primary'" plain @click="edit(scope.row)">{{
                scope.row.edit ? "保存信息" : "编辑信息" }}</el-button>
              <el-button size="small" :type="scope.row.inUse ? 'danger' : 'success'" plain
                @click="setBlock(scope.row.uid, !scope.row.inUse)">
                {{ scope.row.inUse ? "封禁账号" : "解除封禁" }}
              </el-button>
            </span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script>
import axios from "axios"
import { ElMessage } from 'element-plus'

export default {
  name: 'cuteRank',
  data() {
    return {
      total: 0,
      finished: 1,
      currentPage: 1,
      info: [],
      group: ['', '普通用户', '管理员', '超级管理员'],
      tempInfo: {},
      options: [{
        value: 1,
        label: '普通用户',
      }, {
        value: 2,
        label: '管理员',
      }, {
        value: 3,
        label: '超级管理员',
      }],
    }
  },
  methods: {
    all() {
      axios.post('/api/admin/getUserInfoList', {
        pageId: this.currentPage
      }).then(res => {
        this.total = res.data.total;
        this.info = res.data.userList;
        for (let i = 0; i < this.info.length; i++) this.info[i].edit = 0;
        this.finished = 1;
      });
    },
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
    },
    setBlock(uid, status) {
      if (!this.finished) {
        ElMessage({
          message: '请先保存上一次操作',
          type: 'error',
          duration: 2000,
        });
        return;
      }
      axios.post('/api/admin/setBlock', {
        uid: uid,
        status: status
      }).then((res) => {
        if (res.status === 200) {
          this.all();
          ElMessage({
            message: '操作成功',
            type: 'success',
            duration: 1000,
          });
        }
      }).catch(err => {
        ElMessage({
          message: err.message,
          type: 'error',
          duration: 2000,
        });
      });
    },
    edit(row) {
      if (row.edit) {
        axios.post('/api/admin/updateUserInfo', {
          info: this.tempInfo
        }).then((res) => {
          if (res.status === 200) {
            this.all();
            ElMessage({
              message: '操作成功',
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
        }).catch(err => {
          ElMessage({
            message: err.message,
            type: 'error',
            duration: 2000,
          });
        });
        this.finished = 1;
      } else {
        if (!this.finished) {
          ElMessage({
            message: '请先保存上一次操作',
            type: 'error',
            duration: 2000,
          });
          return;
        }
        this.finished = 0;
        this.tempInfo = {
          uid: row.uid,
          name: row.name,
          email: row.email,
          gid: row.gid
        };
      }
      row.edit ^= 1;
    }
  },
  mounted: function () {
    this.all();
  },
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.box-card {
  height: 700px;
  margin: 10px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
}
</style>