<template>
  <el-table :data="rankList.data" height="600px" :header-cell-style="{ textAlign: 'center' }" :cell-style="CellStyle"
    :row-style="{ height: '50px' }" :row-class-name="tableRowClassName">
    <el-table-column type="index" fixed="left" max-width="10%" min-width="60px">
      <template #header>
        <el-button circle @click="all" color="#626aef" plain>
          <el-icon>
            <Refresh />
          </el-icon>
        </el-button>
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
    <el-table-column v-for="(key, value) in rankList.problem" :key="key" max-width="10%" min-width="100px"
      style="background: blue;">
      <template #header>
        <span class="rlink" @click="this.$router.push('/contest/' + cid + '/problem/' + value)"> {{ value }}</span>
        <div class="attach"> ({{ key }})</div>
      </template>
      <template #default="scope">
        <div :style="getScoreStyle(scope.row.detail[value], key)">{{ scope.row.detail[value] ?
          scope.row.detail[value].score : '/' }}</div>
        <div v-if="scope.row.detail[value] && scope.row.detail[value].score > 0" class="attach"> ({{
          scope.row.detail[value].time }} ms)</div>
      </template>
    </el-table-column>
  </el-table>
</template>

<script>
import axios from "axios"
import { ElMessage } from 'element-plus'
import { scoreColor } from '@/assets/common'
import store from "@/sto/store";

export default {
  name: "rankList",
  data() {
    return {
      rankList: [],
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
      style['text-align'] = 'center';
      if (row['detail'][columnIndex - 2] && ('firstBlood' in row['detail'][columnIndex - 2])) {
        style['background'] = '#d9ecff';
      }
      return style;
    },
    tableRowClassName(obj) {
      return (obj.row.user.uid === store.state.uid ? 'success' : '');
    },
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
</style>