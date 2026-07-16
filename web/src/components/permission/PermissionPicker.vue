<template>
  <el-select
    v-model="selected"
    class="permission-picker"
    :multiple="multiple"
    :placeholder="placeholder"
    :clearable="clearable"
    :collapse-tags="collapseTags"
    :collapse-tags-tooltip="collapseTagsTooltip"
    :max-collapse-tags="maxCollapseTags"
    popper-class="permission-picker-popper"
    filterable
    style="width: 100%;"
    @change="onChange"
  >
    <el-option-group v-for="g in groups" :key="g.name" :label="g.name">
      <el-option
        v-for="p in g.items"
        :key="p.key"
        :label="hideKey ? p.name : `${p.name} (${p.key})`"
        :value="p.key"
      >
        <div class="permission-picker-option">
          <span class="permission-picker-option-name">{{ p.name }}</span>
          <code v-if="!hideKey" class="permission-picker-option-key">{{ p.key }}</code>
        </div>
      </el-option>
    </el-option-group>
  </el-select>
</template>

<script>
const GROUP_LABEL = {
  problem: '题目',
  contest: '比赛',
  judge: '判题 / 提交',
  user: '用户',
  system: '系统',
};

export default {
  name: 'PermissionPicker',
  props: {
    modelValue: { type: [String, Array, null], default: null },
    permissions: { type: Array, required: true },     // [{ key, group, name, scopable }]
    whitelist: { type: Array, default: null },        // null = no restriction
    multiple: { type: Boolean, default: false },
    scopableOnly: { type: Boolean, default: false },
    clearable: { type: Boolean, default: true },
    collapseTags: { type: Boolean, default: false },
    collapseTagsTooltip: { type: Boolean, default: false },
    maxCollapseTags: { type: Number, default: 1 },
    placeholder: { type: String, default: '选择权限' },
    // hideKey suppresses the "(permission.key)" suffix in the option label.
    // Used by the resource-collaborator picker, where end users shouldn't see
    // raw keys like `problem.view.any` — only the friendly scoped name.
    hideKey: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'change'],
  data() {
    return { selected: this.modelValue };
  },
  computed: {
    filtered() {
      let list = this.permissions || [];
      if (this.whitelist) {
        const set = new Set(this.whitelist);
        list = list.filter((p) => set.has(p.key));
      }
      if (this.scopableOnly) list = list.filter((p) => p.scopable);
      return list;
    },
    groups() {
      const map = new Map();
      for (const p of this.filtered) {
        const g = p.group || 'other';
        if (!map.has(g)) map.set(g, []);
        map.get(g).push(p);
      }
      return Array.from(map.entries()).map(([k, items]) => ({
        key: k, name: GROUP_LABEL[k] || k, items,
      }));
    },
  },
  watch: {
    modelValue(v) { this.selected = v; },
  },
  methods: {
    onChange(v) {
      this.$emit('update:modelValue', v);
      this.$emit('change', v);
    },
  },
};
</script>

<style scoped>
.permission-picker { width: 100%; }

.permission-picker-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.permission-picker-option-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.permission-picker-option-key {
  margin-left: auto;
  color: #909399;
  font-size: 11px;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .permission-picker :deep(.el-select__wrapper) {
    min-height: 40px;
  }
}
</style>

<style>
@media (max-width: 768px) {
  .permission-picker-popper {
    max-width: calc(100vw - 16px) !important;
  }

  .permission-picker-popper .el-select-dropdown__item {
    height: auto;
    min-height: 44px;
    padding-top: 6px;
    padding-bottom: 6px;
    line-height: 1.3;
    white-space: normal;
  }

  .permission-picker-popper .permission-picker-option {
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }

  .permission-picker-popper .permission-picker-option-name,
  .permission-picker-popper .permission-picker-option-key {
    max-width: 100%;
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .permission-picker-popper .permission-picker-option-key {
    margin-left: 0;
  }
}
</style>
