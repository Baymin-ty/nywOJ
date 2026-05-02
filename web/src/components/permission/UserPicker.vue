<template>
  <el-select
    v-model="selected"
    filterable
    remote
    reserve-keyword
    :placeholder="placeholder"
    :remote-method="search"
    :loading="loading"
    :clearable="clearable"
    style="width: 100%;"
    @change="onChange"
  >
    <el-option
      v-for="u in options"
      :key="u.uid"
      :label="`${u.name} (#${u.uid})`"
      :value="u.uid"
    />
  </el-select>
</template>

<script>
import axios from 'axios';

export default {
  name: 'UserPicker',
  props: {
    modelValue: { type: [Number, null], default: null },
    placeholder: { type: String, default: '搜索用户名或 uid' },
    clearable: { type: Boolean, default: true },
  },
  emits: ['update:modelValue', 'change'],
  data() {
    return {
      selected: this.modelValue,
      options: [],
      loading: false,
    };
  },
  watch: {
    modelValue(v) { this.selected = v; },
  },
  methods: {
    async search(q) {
      const query = (q || '').trim();
      if (!query) { this.options = []; return; }
      this.loading = true;
      try {
        const res = await axios.post('/api/auth/searchUsers', { q: query });
        this.options = (res.data && res.data.users) || [];
      } finally {
        this.loading = false;
      }
    },
    onChange(v) {
      this.$emit('update:modelValue', v);
      const picked = this.options.find((u) => u.uid === v) || null;
      this.$emit('change', picked);
    },
  },
};
</script>
