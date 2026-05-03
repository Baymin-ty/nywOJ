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
      v-for="item in options"
      :key="item.id"
      :label="`#${item.id} ${item.title}`"
      :value="item.id"
    />
  </el-select>
</template>

<script>
import axios from 'axios';

const ENDPOINTS = {
  problem: { url: '/api/auth/searchProblems', listKey: 'problems', idKey: 'pid' },
  contest: { url: '/api/auth/searchContests', listKey: 'contests', idKey: 'cid' },
};

export default {
  name: 'ResourcePicker',
  props: {
    modelValue: { type: [Number, null], default: null },
    resourceType: { type: String, required: true },   // 'problem' | 'contest'
    placeholder: { type: String, default: '' },
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
  computed: {
    cfg() { return ENDPOINTS[this.resourceType]; },
    effectivePlaceholder() {
      if (this.placeholder) return this.placeholder;
      return this.resourceType === 'contest' ? '搜索比赛 cid 或标题' : '搜索题目 pid 或标题';
    },
  },
  watch: {
    modelValue(v) { this.selected = v; },
    resourceType() { this.options = []; this.selected = null; },
  },
  methods: {
    async search(q) {
      const query = (q || '').trim();
      if (!query || !this.cfg) { this.options = []; return; }
      this.loading = true;
      try {
        const res = await axios.post(this.cfg.url, { q: query });
        const list = (res.data && res.data[this.cfg.listKey]) || [];
        this.options = list.map((row) => ({ id: row[this.cfg.idKey], title: row.title }));
      } finally {
        this.loading = false;
      }
    },
    onChange(v) {
      this.$emit('update:modelValue', v);
      this.$emit('change', v);
    },
  },
};
</script>
