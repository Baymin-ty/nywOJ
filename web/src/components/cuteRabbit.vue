<template>
  <div>
    <img v-show="flag" class="round" alt="Rabbit" @click="fun" src="../assets/rabbit-1.jpg">
    <img v-show="!flag" class="round" alt="Rabbit" @click="fun" src="../assets/rabbit-2.jpg">
    <h1 class="rainbow"> 你戳了可爱兔兔 {{ cnt }} 下</h1>
  </div>
</template>

<script>
export default {
  name: 'cuteRabbit',
  data() {
    return {
      cnt: (!document.cookie || document.cookie > 114514) ? 0 : document.cookie,
      flag: 1
    }
  },
  methods: {
    fun() {
      document.cookie = ++this.cnt;
      this.flag ^= 1;
      setTimeout(() => { this.flag ^= 1; }, 66);
    }
  },
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.round {
  width: 500px;
  border-radius: 36px;
}

.rainbow {
  margin: 10px;
  font-size: 80px;
  background-image: linear-gradient(92deg, rgb(38, 243, 93) 0%, rgb(254, 171, 58) 100%);
  color: rgb(38, 82, 243);
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-weight: 600;
}
</style>
