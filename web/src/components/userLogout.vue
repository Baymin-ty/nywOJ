<template>
  感谢使用
</template>

<script>
import axios from "axios";

export default {
  name: "userLogout",
  created() {
    axios.post('/api/user/logout');
    localStorage.removeItem('isLogin');
    location.reload();
  }
}
</script>
