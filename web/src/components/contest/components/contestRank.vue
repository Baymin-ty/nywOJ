<template>
  <el-table :data="rankList.data" height="600px" :header-cell-style="{ textAlign: 'center' }" :cell-style="CellStyle"
    :row-style="{ height: '50px' }" :row-class-name="tableRowClassName" :cell-class-name="cellClassName"
    @cell-click="getExSubmission">
    <el-table-column fixed="left" max-width="10%" min-width="60px">
      <template #header>
        <el-button circle @click="all" color="#626aef" plain>
          <el-icon>
            <Refresh />
          </el-icon>
        </el-button>
      </template>
      <template #default="scope">
        {{ scope.$index + 1 }}
      </template>
    </el-table-column>
    <el-table-column label="用户名" fixed="left" max-width="15%" min-width="150px">
      <template #default="scope">
        <span class="rlink" @click="this.$router.push('/user/' + scope.row.user.uid)">{{ scope.row.user.name }}</span>
      </template>
    </el-table-column>
    <el-table-column label="总分" fixed="left" max-width="10%" min-width="100px">
      <template #default="scope">
        <div class="totScore" v-show="scope.row.submitted">{{ scope.row.totalScore }}</div>
        <div class="attach" v-show="scope.row.submitted">({{ scope.row.usedTime }} ms)</div>
        <span v-show="!scope.row.submitted"> / </span>
      </template>
    </el-table-column>
    <el-table-column v-for="(key, value) in rankList.problem" :key="key" max-width="10%" min-width="100px">
      <template #header>
        <span class="rlink" @click="this.$router.push('/contest/' + cid + '/problem/' + value)"> {{ value }}</span>
        <div class="attach"> ({{ key }})</div>
      </template>
      <template #default="scope">
        <div :style="getScoreStyle(scope.row.detail[value], key)">{{ scope.row.detail[value] ?
          scope.row.detail[value].score : '/' }}</div>
        <div v-if="scope.row.detail[value] && scope.row.detail[value].score > 0" class="attach">
          ({{ scope.row.detail[value].time }} ms)</div>
      </template>
    </el-table-column>
  </el-table>
  <el-dialog v-model="dialogVisible" title="提交记录" width="1200px" center style="border-radius: 10px;">
    <el-table :data="subList" height="600px" :header-cell-style="{ textAlign: 'center' }"
      :cell-style="submissionCellStyle" :row-class-name="submissionTableRowClassName">
      <el-table-column prop="sid" label="#" min-width="5%" />
      <el-table-column prop="title" label="题目" min-width="15%">
        <template #default="scope">
          <span class="rlink" @click="this.$router.push('/contest/' + cid + '/problem/' + scope.row.idx)"> {{
            scope.row.title
          }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="提交者" min-width="12%">
        <template #default="scope">
          <span class="rlink" @click="this.$router.push('/user/' + scope.row.uid)">
            {{ scope.row.name }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="judgeResult" label="评测状态" min-width="13%">
        <template #default="scope">
          <span style="cursor: pointer;"
            @click="this.$router.push({ path: '/submission/' + scope.row.sid, query: { isContest: true } })">
            {{ scope.row.judgeResult }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="score" label="分数" min-width="6%">
        <template #default="scope">
          <span> {{ scope.row.score }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="judgeResult" label="总用时" min-width="10%">
        <template #default="scope">
          <span> {{ scope.row.time }} ms</span>
        </template>
      </el-table-column>
      <el-table-column prop="judgeResult" label="内存" min-width="10%">
        <template #default="scope">
          <span> {{ scope.row.memory }} </span>
        </template>
      </el-table-column>
      <el-table-column prop="codeLength" label="代码长度" min-width="10%">
        <template #default="scope">
          <span> {{ scope.row.codeLength }} B </span>
        </template>
      </el-table-column>
      <el-table-column prop="submitTime" label="提交时间" min-width="19%" />
    </el-table>
  </el-dialog>
</template>

<script>
import axios from "axios"
import { ElMessage } from 'element-plus'
import { scoreColor, resColor } from '@/assets/common'
import store from "@/sto/store";

export default {
  name: "rankList",
  data() {
    return {
      rankList: [],
      subList: [],
      isProblem: false,
      dialogVisible: false,
      gid: 1,
      cid: 0,
    };
  },
  methods: {
    all() {
      axios.post("/api/contest/getRank", {
        cid: this.cid
      }).then(res => {
        this.rankList = res.data;
      }).catch(err => {
        ElMessage({
          message: "获取比赛排行失败" + err.message,
          type: "error",
          duration: 2000,
        });
      });
    },
    getScoreStyle(cur, total) {
      if (!cur)
        return {};
      else {
        let style = {};
        style["line-height"] = "1.2em";
        style["font-size"] = "15px";
        style["font-weight"] = 800;
        style["color"] = scoreColor[Math.floor(cur.score * 10 / total)];
        return style;
      }
    },
    CellStyle({ row, columnIndex }) {
      let style = {};
      if (columnIndex === 2 && row.submitted || columnIndex > 2 && row['detail'][columnIndex - 2]) {
        style['cursor'] = 'pointer';
      }
      style['text-align'] = 'center';
      if (row['detail'][columnIndex - 2] && ('firstBlood' in row['detail'][columnIndex - 2])) {
        style['background'] = '#d9ecff';
      }
      return style;
    },
    tableRowClassName(obj) {
      return (obj.row.user.uid === store.state.uid ? 'success' : '');
    },
    cellClassName({ column, columnIndex }) {
      column.index = columnIndex;
    },
    getExSubmission(row, column) {
      this.isProblem = false;
      if (column.index - 2 < 0) return;
      if (column.index - 2 === 0 && row.submitted) {
        this.dialogVisible = true;
        axios.post('/api/contest/getSingleUserLastSubmission', {
          cid: this.cid,
          uid: row.user.uid
        }).then(res => {
          this.subList = res.data.data;
        });
      } else if (row.detail[column.index - 2]) {
        this.dialogVisible = true;
        this.isProblem = true;
        axios.post('/api/contest/getSingleUserProblemSubmission', {
          cid: this.cid,
          uid: row.user.uid,
          idx: column.index - 2
        }).then(res => {
          this.subList = res.data.data;
        });
      }
    },
    submissionTableRowClassName({ rowIndex }) {
      if (!this.isProblem)
        return 'warning';
      else
        return (rowIndex === 0 ? 'warning' : '');
    },
    submissionCellStyle({ row, columnIndex }) {
      let style = {};
      style['textAlign'] = 'center';
      if (columnIndex === 3) {
        style['font-weight'] = 500;
        style['color'] = resColor[row.judgeResult];
      }
      if (columnIndex === 4) {
        style['font-weight'] = 500;
        style['color'] = scoreColor[Math.floor(row.score / 10)];
      }
      return style;
    }
  },
  mounted() {
    this.gid = this.$store.state.gid;
    this.cid = this.$route.params.cid;
    this.all();
  },
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.attach {
  line-height: 1em;
  font-size: 12px;
  color: var(--el-table-header-text-color);
  font-weight: 400;
}

.totScore {
  line-height: 1.2em;
  font-size: 15px;
  font-weight: 500;
}

.clickable {
  background-color: red;
}
</style>