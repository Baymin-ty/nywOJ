<template>
  <el-row style="width: 1200px;margin: auto;">
    <el-col :span="16">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            公告栏
          </div>
        </template>
        敬请期待
      </el-card>
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            排行榜
          </div>
        </template>
        施工中...
      </el-card>
    </el-col>
    <el-col :span="8">
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            一言（ヒトコト）
            <el-button type="primary" @click="updateHitokoto" color="#626aef" plain>再来一个</el-button>
          </div>
        </template>
        <div style="font-size: 14px; "> {{ motto.hitokoto }} </div>
        <div style="font-size: 12px; color: grey; float: right;margin: 10px;"> from {{ motto.from }} </div>
      </el-card>
      <el-card class="box-card" shadow="hover">
        <template #header>
          <div class="card-header">
            最新题目
          </div>
        </template>
        施工中...
      </el-card>
    </el-col>
  </el-row>
</template>

<script>
import axios from "axios";

export default {
  name: "myHeader",
  data() {
    return {
      motto: '',
    }
  },
  methods: {
    updateHitokoto() {
      axios.get('https://v1.hitokoto.cn/?c=a').then(res => {
        this.motto = res.data
      });
    }
  },
  mounted() {
    this.updateHitokoto();
  },
}
</script>

<style>
.box-card {
  margin: 10px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
  font-weight: bolder;
}
</style>