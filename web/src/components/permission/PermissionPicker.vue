<template>
  <el-select
    v-model="selected"
    :multiple="multiple"
    :placeholder="placeholder"
    :clearable="clearable"
    filterable
    style="width: 100%;"
    @change="onChange"
  >
    <el-option-group v-for="g in groups" :key="g.name" :label="g.name">
      <el-option
        v-for="p in g.items"
        :key="p.key"
        :label="`${p.name} (${p.key})`"
        :value="p.key"
      />
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
    placeholder: { type: String, default: '选择权限' },
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
