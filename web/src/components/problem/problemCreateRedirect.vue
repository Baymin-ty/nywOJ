<template>
  <div class="create-redirect" v-loading="loading">
    <el-card class="create-card" shadow="hover">
      <div class="title">正在创建题目...</div>
      <div class="hint">创建完成后会自动进入题目编辑页。</div>
    </el-card>
  </div>
</template>

<script>
import axios from 'axios';

export default {
  name: 'problemCreateRedirect',
  data() {
    return {
      loading: true,
    };
  },
  async mounted() {
    try {
      const res = await axios.post('/api/problem/createProblem');
      const pid = Number(res && res.data && res.data.pid);
      if (res.status === 200 && Number.isSafeInteger(pid) && pid > 0) {
        this.$router.replace(`/p/id/${pid}/edit`);
        return;
      }
      this.$message.error((res.data && res.data.message) || '创建题目失败');
    } catch (err) {
      const msg = err && err.response && err.response.data && err.response.data.message;
      this.$message.error(msg || err.message || '创建题目失败');
    } finally {
      this.loading = false;
    }
    this.$router.replace('/p');
  },
};
</script>

<style scoped>
.create-redirect {
  margin: 0 auto;
  max-width: 560px;
  padding: 48px 12px;
}

.create-card {
  text-align: center;
}

.title {
  color: #303133;
  font-size: 20px;
  font-weight: 700;
}

.hint {
  color: #909399;
  margin-top: 8px;
}
</style>
