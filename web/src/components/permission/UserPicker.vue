<template>
  <el-select
    v-model="selected"
    class="user-picker"
    filterable
    remote
    reserve-keyword
    :placeholder="placeholder"
    :remote-method="search"
    :loading="loading"
    :clearable="clearable"
    popper-class="user-picker-popper"
    style="width: 100%;"
    @change="onChange"
  >
    <el-option
      v-for="u in options"
      :key="u.uid"
      :label="`${u.name} (#${u.uid})`"
      :value="u.uid"
    >
      <div class="user-picker-option">
        <span class="user-picker-option-name">{{ u.name }}</span>
        <code class="user-picker-option-id">#{{ u.uid }}</code>
      </div>
    </el-option>
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

<style scoped>
.user-picker { width: 100%; }

.user-picker-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.user-picker-option-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-picker-option-id {
  flex-shrink: 0;
  color: #909399;
  font-size: 11px;
}

@media (max-width: 768px) {
  .user-picker :deep(.el-select__wrapper) {
    min-height: 40px;
  }
}
</style>

<style>
@media (max-width: 768px) {
  .user-picker-popper {
    max-width: calc(100vw - 16px) !important;
  }

  .user-picker-popper .el-select-dropdown__item {
    height: auto;
    min-height: 44px;
    padding-top: 6px;
    padding-bottom: 6px;
    line-height: 1.35;
    white-space: normal;
  }

  .user-picker-popper .user-picker-option-name {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
  }
}
</style>
