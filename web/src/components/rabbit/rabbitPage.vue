<template>
  <el-tabs v-model="activeName" style="margin: auto;max-width: 1200px;min-width: 600px;">
    <el-tab-pane label="可爱兔兔" name="first" :key="'first'">
      <child1 />
    </el-tab-pane>

    <el-tab-pane label="排行榜" name="second" :key="'second'">
      <child2 />
    </el-tab-pane>

    <el-tab-pane label="点击统计" name="third" :key="'third'">
      <child3 />
    </el-tab-pane>
  </el-tabs>
</template>

<script>
import cuteRabbit from './com/cuteRabbit.vue'
import cuteRankList from './com/cuteRankList.vue'
import cuteData from './com/rabbitClickData.vue'

export default {
  name: 'rabbitPage',
  components: {
    child1: cuteRabbit,
    child2: cuteRankList,
    child3: cuteData,
  },
  data() {
    return {
      activeName: "third",
    }
  }
}

</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped></style>
