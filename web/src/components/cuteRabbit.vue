<template>
  <div>
    <img v-show="flag" class="round" alt="Rabbit" @click="fun" src="../assets/rabbit-1.jpg">
    <img v-show="!flag" class="round" alt="Rabbit" src="../assets/rabbit-2.jpg">
    <audio ref="hash">
      <source src="../assets/hash.mp3">
    </audio>
    <h1 class="rainbow"> 你戳了可爱兔兔 {{ cnt }} 下</h1>
  </div>
</template>

<script>
export default {
  name: 'cuteRabbit',
  data() {
    let obj = this;
    return {
      cnt: obj.getcookie(),
      flag: 1
    }
  },
  methods: {
    getcookie() {
      var str = document.cookie;
      if (!str.length || str.length > 10)
        return 0;
      for (var i = 0, len = str.length; i < len; i++) {
        if (str[i] < '0' + (!i) || str[i] > '9')
          return 0;
      }
      return str;
    },
    fun() {
      this.$refs.hash.play();
      document.cookie = ++this.cnt;
      this.flag ^= 1;
      setTimeout(() => { this.flag ^= 1; }, 36);
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
