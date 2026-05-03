<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1300px">
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
        :header-cell-style="{ textAlign: 'center' }" v-loading="!loadingFinished">
        <el-table-column prop="uid" width="110px">
          <template #header>
            <div class="table-header">uid</div>
            <el-input v-model="filter.uid" size="small" style="width: 80px;" @keyup.enter="all">
              <template #prefix>
                <el-icon class="el-input__icon"><search /></el-icon>
              </template>
            </el-input>
          </template>
          <template #default="scope">{{ scope.row.uid }}</template>
        </el-table-column>
        <el-table-column prop="name" width="160px">
          <template #header>
            <div class="table-header">用户名</div>
            <el-input v-model="filter.name" size="small" style="width: 130px;" @keyup.enter="all">
              <template #prefix>
                <el-icon class="el-input__icon"><search /></el-icon>
              </template>
            </el-input>
          </template>
          <template #default="scope">
            <router-link :to="'/user/' + scope.row.uid" class="rlink" v-show="!scope.row.edit">
              {{ scope.row.name }}
            </router-link>
            <el-input v-show="scope.row.edit" size="small" style="width:120px" v-model="this.tempInfo.name" />
          </template>
        </el-table-column>
        <el-table-column prop="email" width="280px">
          <template #header>
            <div class="table-header">邮箱</div>
            <el-input v-model="filter.email" size="small" style="width: 200px;" @keyup.enter="all">
              <template #prefix>
                <el-icon class="el-input__icon"><search /></el-icon>
              </template>
            </el-input>
          </template>
          <template #default="scope">
            <span v-show="!scope.row.edit">{{ scope.row.email }}</span>
            <el-input v-show="scope.row.edit" size="small" style="width:200px" v-model="this.tempInfo.email" />
          </template>
        </el-table-column>
        <el-table-column prop="roles" width="240px">
          <template #header>
            <div class="table-header">角色</div>
            <el-select v-model="filter.roleKey" size="small" style="width: 180px;" clearable placeholder="按角色筛选" @change="all">
              <el-option v-for="r in roles" :key="r.key" :label="r.name" :value="r.key" />
            </el-select>
          </template>
          <template #default="scope">
            <el-tag v-for="rk in (scope.row.roles || [])" :key="rk" size="small" style="margin: 1px;">
              {{ roleName(rk) }}
            </el-tag>
            <span v-if="!(scope.row.roles && scope.row.roles.length)" style="color:#909399">（无）</span>
          </template>
        </el-table-column>
        <el-table-column prop="inUse" width="auto">
          <template #header>
            <div class="table-header">状态</div>
            <el-select v-model="filter.inUse" size="small" style="width: 90px;">
              <el-option v-for="item in status" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </template>
          <template #default="scope">
            <span>{{ scope.row.inUse ? "正常" : "封禁" }}</span>
          </template>
        </el-table-column>
        <el-table-column fixed="right" width="360px">
          <template #header>
            <div class="table-header">操作</div>
            <el-button size="small" @click="this.all">筛选记录</el-button>
            <el-button size="small" @click="clear">显示全部</el-button>
          </template>
          <template #default="scope">
            <span>
              <el-button size="small" :type="scope.row.edit ? 'warning' : 'primary'" plain @click="edit(scope.row)" v-if="$can('user.edit')">
                {{ scope.row.edit ? "保存信息" : "编辑信息" }}
              </el-button>
              <el-button size="small" :type="scope.row.inUse ? 'danger' : 'success'" plain v-if="$can('user.ban')"
                @click="setBlock(scope.row.uid, !scope.row.inUse)">
                {{ scope.row.inUse ? "封禁账号" : "解除封禁" }}
              </el-button>
              <el-button size="small" type="info" plain v-if="$canAny('user.role.assign','user.permission.grant')"
                @click="openPermission(scope.row.uid)">
                角色权限
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
import qs from 'qs'

export default {
  name: 'userManage',
  data() {
    return {
      total: 0,
      finished: 1,
      currentPage: 1,
      loadingFinished: false,
      info: [],
      roles: [],            // catalog from /api/auth/listRoles
      tempInfo: {},
      filter: {
        uid: null,
        name: null,
        email: null,
        roleKey: null,
        inUse: null,
      },
      status: [{ value: 1, label: '正常' }, { value: 2, label: '封禁' }],
    }
  },
  methods: {
    roleName(key) {
      const r = this.roles.find((x) => x.key === key);
      return r ? r.name : key;
    },
    async loadRoles() {
      try {
        const res = await axios.post('/api/auth/listRoles');
        if (res.status === 200) this.roles = (res.data && res.data.roles) || [];
      } catch (_) { /* allowed to fail silently — table still renders raw keys */ }
    },
    all() {
      this.loadingFinished = false;
      let param = {}, url = location.pathname;
      if (this.filter.uid) param.uid = this.filter.uid;
      if (this.filter.name) param.name = this.filter.name;
      if (this.filter.email) param.email = this.filter.email;
      if (this.filter.roleKey) param.roleKey = this.filter.roleKey;
      if (this.filter.inUse) param.inUse = this.filter.inUse;
      if (this.currentPage > 1) param.pageId = this.currentPage;
      let nurl = qs.stringify(param);
      if (nurl) url += ('?' + nurl);
      history.state.current = url;
      history.replaceState(history.state, null, url);
      axios.post('/api/admin/getUserInfoList', {
        pageId: this.currentPage,
        filter: this.filter,
      }).then(res => {
        this.loadingFinished = true;
        this.total = res.data.total;
        this.info = res.data.userList;
        for (let i = 0; i < this.info.length; i++) this.info[i].edit = 0;
        this.finished = 1;
      });
    },
    clear() {
      this.filter = { uid: null, name: null, email: null, roleKey: null, inUse: null };
      this.all();
    },
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
    },
    setBlock(uid, status) {
      if (!this.finished) {
        this.$message.error('请先保存上一次操作');
        return;
      }
      axios.post('/api/admin/setBlock', { uid, status }).then((res) => {
        if (res.status === 200) {
          this.all();
          this.$message.success('操作成功');
        }
      }).catch(err => this.$message.error(err.message));
    },
    edit(row) {
      if (row.edit) {
        axios.post('/api/admin/updateUserInfo', { info: this.tempInfo }).then((res) => {
          if (res.status === 200) { this.all(); this.$message.success('操作成功'); }
          else this.$message.error(res.data.message);
        }).catch(err => this.$message.error(err.message));
        this.finished = 1;
      } else {
        if (!this.finished) { this.$message.error('请先保存上一次操作'); return; }
        this.finished = 0;
        this.tempInfo = { uid: row.uid, name: row.name, email: row.email };
      }
      row.edit ^= 1;
    },
    openPermission(uid) {
      this.$router.push({ path: '/admin/permissions', query: { tab: 'userGrants', uid } });
    },
  },
  async mounted() {
    let query = this.$route.query;
    if (query.uid) this.filter.uid = query.uid;
    if (query.name) this.filter.name = query.name;
    if (query.email) this.filter.email = query.email;
    if (query.roleKey) this.filter.roleKey = query.roleKey;
    if (query.inUse) this.filter.inUse = parseInt(query.inUse);
    if (query.pageId) this.currentPage = parseInt(query.pageId);
    await this.loadRoles();
    this.all();
  },
}
</script>

<style scoped>
.box-card { margin: 10px; }
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
}
.table-header { text-align: center; height: 30px; }
</style>
