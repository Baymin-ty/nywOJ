<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1200px">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          更新于: {{ updateTime }}
        </div>
      </template>
      <div id="clickCnt" style="max-width:1000px; margin: 0 auto;" :style="{ width: '100%', height: '300px' }"></div>
      <div id="userCnt" style="max-width:1000px; margin: 0 auto;" :style="{ width: '100%', height: '300px' }"></div>
    </el-card>
  </div>
</template>

<script>
import axios from "axios"
import { ElMessage } from 'element-plus'
import chart from '@/chart/myChart'

export default {
  name: 'rabbitClickData',
  data() {
    return {
      date: [],
      clickCnt: [],
      userCnt: [],
      updateTime: null,
    }
  },
  async mounted() {
    await axios.post('/api/rabbit/getClickData').then(res => {
      if (res.status === 200) {
        this.updateTime = res.data.updateTime;
        for (let i = 0; i < res.data.data.length; i++) {
          this.date[i] = res.data.data[i].date;
          this.clickCnt[i] = res.data.data[i].clickCnt;
          this.userCnt[i] = res.data.data[i].userCnt;
        }
        ElMessage({
          message: '获取点击统计成功',
          type: 'success',
          duration: 1000,
        });
      } else ElMessage({
        message: '请稍后再试',
        type: 'error',
        duration: 2000,
      });
    }).catch(err => {
      ElMessage({
        message: '添加点击信息失败' + err.message,
        type: 'error',
        duration: 2000,
      });
    });
    let clickCnt = chart.init(document.getElementById("clickCnt"));
    clickCnt.setOption({
      "grid": {
        "left": 30,
        "top": 60,
        "right": 10,
        "bottom": 50,
        "containLabel": true
      },
      "title": {
        "show": true,
        "text": "每日点击总次数",
        "left": "center",
        "top": "top"
      },
      "xAxis": {
        "type": "category",
        "data": this.date,
        "axisLine": {
          "show": true
        },
        "axisTick": {
          "show": false
        }
      },
      "yAxis": {
        "type": "value",
        "axisLine": {
          "show": false
        },
        "axisTick": {
          "show": false
        }
      },
      "tooltip": {
        "show": true,
        "trigger": "axis",
        "axisPointer": {
          "type": "none"
        }
      },
      "series": [
        {
          "name": "总次数",
          "type": "line",
          "color": "#5470c6",
          "data": this.clickCnt
        }
      ]
    });
    let userCnt = chart.init(document.getElementById("userCnt"));
    userCnt.setOption({
      "grid": {
        "left": 30,
        "top": 60,
        "right": 10,
        "bottom": 50,
        "containLabel": true
      },
      "title": {
        "show": true,
        "text": "每日点击用户数",
        "left": "center",
        "top": "top"
      },
      "xAxis": {
        "type": "category",
        "data": this.date,
        "axisLine": {
          "show": true
        },
        "axisTick": {
          "show": false
        }
      },
      "yAxis": {
        "type": "value",
        "axisLine": {
          "show": false
        },
        "axisTick": {
          "show": false
        }
      },
      "tooltip": {
        "show": true,
        "trigger": "axis",
        "axisPointer": {
          "type": "none"
        }
      },
      "series": [
        {
          "name": "用户数",
          "type": "line",
          "color": "green",
          "data": this.userCnt
        }
      ]
    });
    window.onresize = () => { clickCnt.resize(), userCnt.resize() };
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