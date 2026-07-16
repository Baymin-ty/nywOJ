<template>
  <el-select
    v-model="selected"
    class="resource-picker"
    filterable
    remote
    reserve-keyword
    :placeholder="effectivePlaceholder"
    :remote-method="search"
    :loading="loading"
    :clearable="clearable"
    popper-class="resource-picker-popper"
    style="width: 100%;"
    @change="onChange"
  >
    <el-option
      v-for="item in options"
      :key="item.id"
      :label="`#${item.id} ${item.title}`"
      :value="item.id"
    >
      <div class="resource-picker-option">
        <code class="resource-picker-option-id">#{{ item.id }}</code>
        <span class="resource-picker-option-title">{{ item.title }}</span>
      </div>
    </el-option>
  </el-select>
</template>

<script>
import axios from 'axios';

const ENDPOINTS = {
  problem: { url: '/api/auth/searchProblems', listKey: 'problems', idKey: 'pid' },
  contest: { url: '/api/auth/searchContests', listKey: 'contests', idKey: 'cid' },
};

const PLACEHOLDERS = {
  problem: '搜索题目 pid 或标题',
  contest: '搜索比赛 cid 或标题',
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
      return PLACEHOLDERS[this.resourceType] || '搜索资源 ID 或标题';
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

<style scoped>
.resource-picker { width: 100%; }

.resource-picker-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.resource-picker-option-id {
  flex-shrink: 0;
  color: #409eff;
  font-size: 11px;
}

.resource-picker-option-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 768px) {
  .resource-picker :deep(.el-select__wrapper) {
    min-height: 40px;
  }
}
</style>

<style>
@media (max-width: 768px) {
  .resource-picker-popper {
    max-width: calc(100vw - 16px) !important;
  }

  .resource-picker-popper .el-select-dropdown__item {
    height: auto;
    min-height: 44px;
    padding-top: 6px;
    padding-bottom: 6px;
    line-height: 1.35;
    white-space: normal;
  }

  .resource-picker-popper .resource-picker-option {
    align-items: flex-start;
  }

  .resource-picker-popper .resource-picker-option-title {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
  }
}
</style>
