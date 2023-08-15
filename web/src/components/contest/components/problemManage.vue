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
            <span class="rlink" @click="this.$router.push('/problem/' + scope.row.pid)">
              {{ scope.row.title }}
            </span>
            <el-icon id="hidden" v-if="!scope.row.isPublic">
              <Hide />
            </el-icon>
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
            <span class="rlink" @click="this.$router.push('/user/' + scope.row.publisherUid)">
              {{ scope.row.publisher }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </el-col>
  </el-row>
</template>

<script>
import axios from "axios"
import { ElMessage } from 'element-plus'
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
      gid: 1,
      cid: 0,
      currentPage: 1,
      addpid: '',
    }
  },
  methods: {
    all() {
      axios.post('/api/contest/getProblemList', {
        cid: this.cid
      }).then(res => {
        this.problemList = res.data.data;
      }).catch(err => {
        ElMessage({
          message: '获取题目列表失败' + err.message,
          type: 'error',
          duration: 2000,
        });
      });
    },
    addProblem() {
      this.addpid = parseInt(this.addpid);
      for (let i = 0; i < this.problemList.length; i++) {
        if (this.problemList[i].pid === this.addpid) {
          ElMessage({
            message: '题目已存在',
            type: 'error',
            duration: 2000,
          });
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
          ElMessage({
            message: '获取题目信息错误',
            type: 'error',
            duration: 2000,
          });
        }
      });
    },
    updateContestProblem() {
      axios.post('/api/contest/updateProblemList', {
        cid: this.cid,
        list: this.problemList
      }).then(res => {
        if (res.status === 200) {
          ElMessage({
            message: '修改成功',
            type: 'success',
            duration: 1000,
          });
        }
        else {
          ElMessage({
            message: '修改失败' + res.data.message,
            type: 'error',
            duration: 2000,
          });
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
</style>