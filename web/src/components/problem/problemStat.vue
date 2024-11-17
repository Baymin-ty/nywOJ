<template>
  <el-row style="margin: auto;max-width: 1400px;min-width: 600px;">
    <el-col :xs="24" :sm="24" :md="12">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            提交统计
          </div>
        </template>
        <div id="submissionStat" :style="{ width: '100%', height: '600px' }" />
      </el-card>
    </el-col>
    <el-col :xs="24" :sm="24" :md="12">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            题解
            <el-button-group v-if="this.$store.state.gid > 1">
              <el-button type="success" :disabled="!bindMark.length" @click="bindPaste2Problem">
                <el-icon class="el-icon--left">
                  <Plus />
                </el-icon>
                绑定
              </el-button>
              <el-input v-model="bindMark" style="width: 150px;" placeholder="绑定剪贴板mark"
                @keyup.enter="bindPaste2Problem" />
            </el-button-group>
          </div>
        </template>
        <el-table :data="solList" max-height="200px" :header-cell-style="{ textAlign: 'center' }"
          :cell-style="{ textAlign: 'center' }">
          <el-table-column prop="title" label="标题" min-width="40%">
            <template #default="scope">
              <router-link class="rlink" :to="'/paste/' + scope.row.mark">
                {{ scope.row.title }}
              </router-link>
              <el-icon id="hidden" style="vertical-align: -2px;" v-if="!scope.row.isPublic">
                <Hide />
              </el-icon>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="发布者" min-width="25%">
            <template #default="scope">
              <router-link class="rlink" :to="'/user/' + scope.row.uid">
                {{ scope.row.name }}
              </router-link>
            </template>
          </el-table-column>
          <el-table-column prop="time" label="更新时间" min-width="20%" />
          <el-table-column v-if="this.$store.state.gid > 1" label="操作" min-width="15%">
            <template #default="scope">
              <el-popconfirm confirm-button-text="确认" cancel-button-text="取消" title="确认解绑?"
                @confirm="unbindSol(scope.row.id)">
                <template #reference>
                  <el-button size="small" type="danger" plain>解绑</el-button>
                </template>
              </el-popconfirm>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            最快提交
          </div>
        </template>
        <el-table :data="submissionList" height="auto" :header-cell-style="{ textAlign: 'center' }"
          :cell-style="cellStyle" :row-class-name="tableRowClassName">
          <el-table-column prop="sid" label="#" width="100px" />
          <el-table-column prop="name" label="提交者" width="auto">
            <template #default="scope">
              <router-link class="rlink" :to="'/user/' + scope.row.uid">
                {{ scope.row.name }}
              </router-link>
            </template>
          </el-table-column>
          <el-table-column prop="codeLength" label="代码长度" width="80px">
            <template #default="scope">
              <span> {{ scope.row.codeLength }} B </span>
            </template>
          </el-table-column>
          <el-table-column prop="judgeResult" label="总用时" fixed="right" width="100px">
            <template #default="scope">
              <span class="rlink" @click="go2s(scope)">
                {{ scope.row.time }} ms
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="judgeResult" label="内存" fixed="right" width="100px">
            <template #default="scope">
              <span> {{ scope.row.memory }} </span>
            </template>
          </el-table-column>
          <el-table-column prop="machine" label="评测机" fixed="right" width="120px" />
        </el-table>
      </el-card>
    </el-col>
  </el-row>
</template>

<script>
import axios from 'axios';
import chart from '@/chart/myChart'
import { resColor } from '@/assets/common'

export default {
  name: "problemStat",
  data() {
    return {
      pid: 0,
      submissionList: [],
      solList: [],
      bindMark: '',
      submissionOption: {
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' }
        },
        legend: {
          show: true,
          left: 'center',
          top: 'top'
        },
        grid: {
          left: '3%',
          right: '3%',
          bottom: '4%',
          containLabel: true
        },
        xAxis: {
          type: 'category',
          data: [],
          axisLabel: {
            fontSize: 15
          }
        },
        yAxis: {
          type: 'value',
          axisLabel: {
            fontSize: 15
          }
        },
        series: []
      }
    }
  },
  methods: {
    tableRowClassName(obj) {
      return (obj.row.cid ? 'warning' : '');
    },
    go2s(scope) {
      if (!scope.row.cid)
        this.$router.push('/submission/' + scope.row.sid);
      else
        this.$router.push({ path: '/submission/' + scope.row.sid, query: { isContest: true } })
    },
    cellStyle({ row, columnIndex }) {
      let style = {};
      style['textAlign'] = 'center';
      if (columnIndex === 3) {
        style['font-weight'] = 500;
        style['color'] = resColor[row.judgeResult];
      }
      return style;
    },
    getSubmissionBar() {
      axios.post('/api/problem/getProblemStat', { pid: this.pid }).then(res => {
        if (res.status === 200) {
          let scoreMap = new Map(), resMap = new Map(), colorKeys = Object.keys(resColor);
          for (let i of res.data.stat) {
            if (!scoreMap.has(i.score)) {
              scoreMap.set(i.score, this.submissionOption.xAxis.data.length);
              this.submissionOption.xAxis.data.push(i.score)
            }
          }
          for (let i of res.data.stat) {
            if (!resMap.has(i.judgeResult)) {
              resMap.set(i.judgeResult, this.submissionOption.series.length)
              this.submissionOption.series.push({
                name: i.judgeResult,
                type: 'bar',
                stack: 'total',
                color: resColor[i.judgeResult],
                label: {
                  show: true,
                  position: 'inside',
                  color: 'white',
                  fontSize: 15,
                  formatter: (params) => {
                    return params.value > 0 ? params.value : '';
                  }
                },
                emphasis: { focus: 'series' },
                data: new Array(scoreMap.size).fill(0)
              })
            }
          }
          for (let i of res.data.stat)
            this.submissionOption.series[resMap.get(i.judgeResult)].data[scoreMap.get(i.score)] = i.cnt;
          let submissionChart = chart.init(document.getElementById('submissionStat'));
          submissionChart.setOption(this.submissionOption);
          window.onresize = () => { submissionChart.resize() };
          submissionChart.on('click', (params) => {
            if (params.componentType === 'series') {
              let score = params.name;
              let judgeResult = params.seriesName;
              this.$router.push({ path: '/submission', query: { pid: this.pid, score: score, res: colorKeys.indexOf(judgeResult), queryAll: true } });
            }
          });
        } else {
          this.$message.error(res.data.message);
        }
      });
    },
    getFastestSubmission() {
      axios.post('/api/problem/getProblemFastestSubmission', { pid: this.pid }).then(res => {
        if (res.status === 200) {
          this.submissionList = res.data.data;
        } else {
          this.$message.error(res.data.message);
        }
      });
    },
    bindPaste2Problem() {
      axios.post('/api/problem/bindPaste2Problem', {
        pid: this.pid,
        mark: this.bindMark
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('绑定剪贴板成功');
          this.bindMark = '';
        }
        else {
          this.$message.error(res.data.message);
        }
        this.getSol();
      });
    },
    getSol() {
      axios.post('/api/problem/getProblemSol', { pid: this.pid }).then(res => {
        if (res.status === 200) {
          this.solList = res.data.data;
        } else {
          this.$message.error(res.data.message);
        }
      });
    },
    unbindSol(id) {
      axios.post('/api/problem/unbindSol', {
        id: id,
      }).then(res => {
        if (res.status === 200) {
          this.$message.success('解除绑定成功');
          this.bindMark = '';
        }
        else {
          this.$message.error(res.data.message);
        }
        this.getSol();
      });
    }
  },
  mounted() {
    this.pid = this.$route.params.pid;
    this.getSubmissionBar();
    this.getFastestSubmission();
    this.getSol();
  }
}
</script>

<style scoped>
.box-card {
  margin: 10px;
  text-align: left;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
}

:deep(.el-card__body) {
  padding-top: 8px;
}
</style>