<template>
  <v-md-preview :text="text" height="400px"></v-md-preview>
</template>

<script>
export default {
  name: "problemView",
  data() {
    return {
      text: '# 123\n123$1$\n2 $12$ 3',
    }
  },
  mounted() {
    this.pid = this.$route.params.pid;

  }
}
</script>

<style scoped></style>