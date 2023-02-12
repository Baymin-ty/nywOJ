<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1200px">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          点击统计
        </div>
      </template>
      <div id="clickCnt" :style="{ width: '100%', height: '300px' }"></div>
      <div id="userCnt" :style="{ width: '100%', height: '300px' }"></div>
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
    }
  },
  async mounted() {
    await axios.get('/api/rabbit/getClickData', {
    }).then(res => {
      if (res.data.status === 200) {
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
      }
    }).catch(err => {
      ElMessage({
        message: '添加点击信息失败' + err.message,
        type: 'error',
        duration: 2000,
      });
    });
    let clickCnt = chart.init(document.getElementById("clickCnt"));
    clickCnt.setOption({
      title: { text: "每日点击总次数", left: "center", },
      xAxis: {
        data: this.date,
      },
      yAxis: {},
      series: [
        {
          type: "line",
          data: this.clickCnt,
        },
      ],
    });
    let userCnt = chart.init(document.getElementById("userCnt"));
    userCnt.setOption({
      title: { text: "每日点击用户数", left: "center", },
      xAxis: {
        data: this.date,
      },
      yAxis: {},
      series: [
        {
          type: "line",
          data: this.userCnt,
          itemStyle: {
            normal: {
              color: 'green',
              lineStyle: {
                color: 'green'
              }
            }
          },
        },
      ],
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