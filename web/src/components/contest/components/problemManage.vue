<template>
  <el-row>
    <el-col :span="6">
      <el-input v-model="addpid" style="width: 150px;" placeholder="添加题目pid" @keyup.enter="addProblem" />
      <el-button-group style="margin: 5px;">
        <el-button type="success" :disabled="!addpid.length" @click="addProblem">
          <el-icon class="el-icon--left">
            <Plus />
          </el-icon>
          添加
        </el-button>
        <el-button type="danger" @click="updateContestProblem">
          保存修改
        </el-button>
      </el-button-group>
      <el-divider />
      <div class="draggable">
        <draggable :list="problemList" itemKey="pid" ghost-class="ghost" chosen-class="chosenClass" animation="300">
          <template #item="{ element }">
            <div class="item">
              #{{ element.pid }}、{{ element.title }}
            </div>
          </template>
        </draggable>
      </div>
    </el-col>
    <el-col :span="18">
      <el-table style="margin-left: 30px;min-height: 600px;" :data="problemList" min-height="600px"
        :header-cell-style="{ textAlign: 'center' }" :cell-style="{ textAlign: 'center' }">
        <el-table-column fixed="left" label="删除" min-width="10%">
          <template #default="scope">
            <el-button link type="primary" size="small" @click.prevent="problemList.splice(scope.$index, 1)">
              <el-icon>
                <CloseBold />
              </el-icon>
            </el-button>
          </template>
        </el-table-column>
        <el-table-column prop="pid" label="pid" min-width="10%" />
        <el-table-column prop="title" label="标题" min-width="25%">
          <template #default="scope">
            <router-link class="rlink" :to="'/problem/' + scope.row.pid">
              {{ scope.row.title }}
            </router-link>
            <el-icon id="hidden" v-if="!scope.row.isPublic">
              <Hide />
            </el-icon>
          </template>
        </el-table-column>
        <el-table-column label="体检" min-width="10%">
          <template #default="scope">
            <el-popover v-if="healthOf(scope.row)" placement="top" width="360" trigger="hover">
              <template #reference>
                <span class="health-dot" :class="'health-' + healthOf(scope.row).level" />
              </template>
              <div v-for="(item, i) in healthOf(scope.row).items" :key="i" class="health-item">
                <el-tag size="small" :type="{ error: 'danger', warn: 'warning', ok: 'success' }[item.level]">
                  {{ { error: '错误', warn: '警告', ok: '正常' }[item.level] }}
                </el-tag>
                <span class="health-title">{{ item.title }}</span>
                <div v-if="item.detail" class="health-detail">{{ item.detail }}</div>
              </div>
            </el-popover>
            <span v-else-if="scope.row.idx === undefined" class="health-unsaved">未保存</span>
            <span v-else>/</span>
          </template>
        </el-table-column>
        <el-table-column prop="weight" label="满分" min-width="20%">
          <template #default="scope">
            <el-input v-model="scope.row.weight" style="height:25px; width: 60px;" />
          </template>
        </el-table-column>
        <el-table-column prop="time" label="发布时间" min-width="17%" />
        <el-table-column prop="publisher" label="出题人" min-width="18%">
          <template #default="scope">
            <router-link class="rlink" :to="'/user/' + scope.row.publisherUid">
              {{ scope.row.publisher }}
            </router-link>
          </template>
        </el-table-column>
      </el-table>
    </el-col>
  </el-row>
</template>

<script>
import axios from "axios"
import draggable from 'vuedraggable'

export default {
  name: 'problemManage',
  components: {
    draggable,
  },
  data() {
    return {
      problemList: [],
      total: 0,
      cid: 0,
      currentPage: 1,
      addpid: '',
      healthByIdx: {},
    }
  },
  methods: {
    all() {
      axios.post('/api/contest/getProblemList', {
        cid: this.cid
      }).then(res => {
        this.problemList = res.data.data;
        this.fetchHealth();
      }).catch(err => {
        this.$message.error('获取题目列表失败' + err.message);
      });
    },
    // 每题体检状态点：checkContest 的题目级结果按 idx 聚合，级别取最严重
    fetchHealth() {
      axios.post('/api/contest/checkContest', { cid: this.cid }).then(res => {
        const byIdx = {};
        const rank = { error: 2, warn: 1, ok: 0 };
        for (const c of res.data.data.checks || []) {
          if (c.scope !== 'problem' || c.idx == null) continue;
          if (!byIdx[c.idx]) byIdx[c.idx] = { level: 'ok', items: [] };
          byIdx[c.idx].items.push(c);
          if (rank[c.level] > rank[byIdx[c.idx].level]) byIdx[c.idx].level = c.level;
        }
        this.healthByIdx = byIdx;
      }).catch(() => { this.healthByIdx = {}; });
    },
    healthOf(row) {
      return row.idx !== undefined ? this.healthByIdx[row.idx] : null;
    },
    addProblem() {
      this.addpid = parseInt(this.addpid);
      for (let i = 0; i < this.problemList.length; i++) {
        if (this.problemList[i].pid === this.addpid) {
          this.$message.error('题目已存在');
          this.addpid = '';
          return;
        }
      }
      axios.post('/api/problem/getProblemInfo', {
        pid: this.addpid
      }).then(res => {
        if (res.status === 200) {
          res.data.data.weight = 100;
          this.problemList.push(res.data.data);
          this.addpid = '';
        }
        else {
          this.$message.error('获取题目信息错误');
        }
      });
    },
    updateContestProblem() {
      axios.post('/api/contest/updateProblemList', {
        cid: this.cid,
        list: this.problemList
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('修改成功');
        }
        else {
          this.$message.error('修改失败' + res.data.message);
        }
        this.all();
      });
    }
  },
  mounted() {
    this.cid = this.$route.params.cid;
    this.all();
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.draggable {
  /* width: 300px; */
  display: flex;
}

.draggable>div:nth-of-type(1) {
  flex: 1;
}

.draggable>div:nth-of-type(2) {
  width: 270px;
  padding-left: 20px;
}

.item {
  border: solid 1px #eee;
  padding: 6px 10px;
  text-align: left;
}

.item:hover {
  cursor: move;
}

.item+.item {
  margin-top: 10px;
}

.ghost {
  border: solid 1px rgb(19, 41, 239);
}

.chosenClass {
  background-color: #f1f1f1;
}

.health-dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  cursor: pointer;
}

.health-ok {
  background: #67c23a;
}

.health-warn {
  background: #e6a23c;
}

.health-error {
  background: #f56c6c;
}

.health-unsaved {
  color: #909399;
  font-size: 12px;
}

.health-item+.health-item {
  margin-top: 6px;
}

.health-title {
  margin-left: 6px;
  font-size: 13px;
}

.health-detail {
  color: #909399;
  font-size: 12px;
  margin: 2px 0 0 2px;
}
</style>