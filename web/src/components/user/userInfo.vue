<template>
  <div style="margin: auto;max-width: 1000px;min-width: 800px;">
    <el-row>
      <el-col :span="7">
        <div style="margin: 0 20px;">
          <el-avatar shape="square" :size="250" :src="avatarAddress" />
        </div>
        <div id="name">
          {{ info.name }}
        </div>
        <el-button v-if="this.$store.state.uid === parseInt(this.uid)" type="info" plain
          @click="this.$router.push('/user/edit/');" id="modify">修改资料</el-button>
        <div v-if="info.email" class="infos">
          <span class="subtitle">邮箱</span>
          <span style="float: right;">{{ info.email }}</span>
        </div>
        <div class="infos">
          <span class="subtitle">用户类型</span>
          <span style="float: right;">{{ group[info.gid] }}</span>
        </div>
        <div class="infos">
          <span class="subtitle">注册时间</span>
          <span style="float: right;">{{ info.reg_time }}</span>
        </div>
        <div v-if="info.login_time" class="infos">
          <span class="subtitle">登录时间</span>
          <span style="float: right;">{{ info.login_time }}</span>
        </div>
        <div class="infos">
          <span class="subtitle">兔兔点击数</span>
          <span style="float: right;">{{ info.clickCnt }}</span>
        </div>
      </el-col>
      <el-col :span="17">
        <div id="clickCnt" :style="{ width: '100%', height: '200px', textAlign: 'center' }"></div>
        <el-card id="main" shadow="never">
          <v-md-preview :text="info.motto" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script>
import axios from "axios";
import chart from '@/chart/myChart'

export default {
  name: "userInfo",
  data() {
    return {
      uid: 0,
      info: {},
      newMotto: '/',
      avatarAddress: '',
      group: ['', '普通用户', '管理员', '超级管理员'],
      date: [],
      clickCnt: [],
    }
  },
  methods: {
    all() {
      axios.post('/api/user/getUserPublicInfo', {
        uid: this.uid
      }).then((res) => {
        if (res.data.info) {
          this.info = res.data.info;
          if (!this.info.motto) {
            this.info.motto = "Ta暂时没有编辑个人主页噢"
          }
          this.avatarAddress = this.getAvatarAddress(this.info.qq);
        }
        else {
          this.$router.go(-1);
        }
      });
    },
    getAvatarAddress(qq) {
      if (!qq || !qq.length) return 'https://cdn.ty.szsyzx.cn/default-avatar.svg';
      return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=5`;
    },
    async getUserClickData() {
      await axios.post('/api/rabbit/getClickData', {
        uid: this.uid,
        day: 14
      }).then(res => {
        for (let i = 0; i < res.data.data.length; i++) {
          this.date[i] = res.data.data[i].date;
          this.clickCnt[i] = res.data.data[i].clickCnt;
        }
      });
      let clickCnt = chart.init(document.getElementById("clickCnt"));
      clickCnt.setOption({
        grid: {
          left: 10,
          top: 40,
          right: 10,
          bottom: 10,
          containLabel: true
        },
        title: {
          show: true,
          text: '兔兔每日点击数',
          left: 'center',
          top: 'top'
        },
        xAxis: {
          type: 'category',
          data: this.date,
          axisLine: {
            show: true
          },
        },
        yAxis: {
          type: 'value',
        },
        tooltip: {
          show: true,
          trigger: 'axis',
          axisPointer: {
            type: 'shadow'
          }
        },
        series: [
          {
            name: '次数',
            type: 'bar',
            color: '#5470c6',
            barWidth: '60%',
            label: {
              show: true,
              position: 'top'
            },
            data: this.clickCnt
          },
        ]
      });
      window.onresize = () => { clickCnt.resize() };
    }
  },
  mounted() {
    this.uid = this.$route.params.uid;
    this.all();
    this.getUserClickData();
  }
}
</script>

<style scoped>
#name {
  font-size: 25px;
  font-weight: 600;
  margin: 10px 20px 15px;
}

#modify {
  width: 250px;
  height: 35px;
  margin: 0 20px 15px;
  font-size: 15px;
  font-weight: 600;
  color: #3f3f3f;
}

.infos {
  width: 250px;
  height: 30px;
  margin: 5px 20px;
  font-size: 15px;
  font-weight: 500;
  color: #656565;
}

.subtitle {
  float: left;
  color: #3f3f3f;
  font-weight: 600;
}

#main {
  min-height: 400px;
  overflow-y: scroll;
}
</style>