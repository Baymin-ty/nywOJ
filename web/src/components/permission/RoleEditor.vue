<template>
  <el-dialog
    v-model="visible"
    class="role-editor-dialog"
    :title="isCreate ? '新建角色' : `编辑角色：${form.key}`"
    width="760px"
    top="6vh"
    @closed="onClosed"
  >
    <div class="role-editor-body">
      <el-alert v-if="!isRoot" type="warning" show-icon :closable="false"
        title="只有 uid=1 可以保存角色变更" style="margin-bottom: 12px;">
        <div>当前页面仅用于查看角色配置，保存请求会被服务端拒绝。</div>
      </el-alert>
      <el-alert v-else-if="role && role.builtin" type="warning" show-icon :closable="false"
        title="正在编辑内置角色" style="margin-bottom: 12px;">
        <div>修改将影响所有持有该角色的用户。</div>
      </el-alert>
      <el-form :model="form" label-width="100px" class="role-editor-form">
        <el-form-item label="角色 key">
          <el-input v-model="form.key" :disabled="!isCreate" placeholder="role_setter (小写字母/数字/下划线)" />
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="出题人" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="包含权限" class="permission-form-item">
          <PermissionPicker
            v-model="form.permissionKeys"
            :permissions="permissions"
            multiple
            collapse-tags
            collapse-tags-tooltip
            :max-collapse-tags="3"
            placeholder="勾选权限"
          />
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="!isRoot" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script>
import axios from 'axios';
import PermissionPicker from './PermissionPicker.vue';

const emptyForm = () => ({ key: '', name: '', description: '', permissionKeys: [] });

export default {
  name: 'RoleEditor',
  components: { PermissionPicker },
  props: {
    modelValue: { type: Boolean, default: false },
    role: { type: Object, default: null },          // null = create
    permissions: { type: Array, required: true },
  },
  emits: ['update:modelValue', 'saved'],
  data() {
    return { form: emptyForm(), saving: false };
  },
  computed: {
    visible: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },
    isCreate() { return !this.role; },
    isRoot() { return this.$store.state.isRoot; },
  },
  watch: {
    modelValue(open) {
      if (!open) return;
      if (this.role) {
        this.form = {
          key: this.role.key,
          name: this.role.name,
          description: this.role.description || '',
          permissionKeys: [...(this.role.permissions || [])],
        };
      } else {
        this.form = emptyForm();
      }
    },
  },
  methods: {
    onClosed() {
      this.form = emptyForm();
      this.saving = false;
    },
    async save() {
      if (!this.isRoot) {
        this.$message.error('只有 uid=1 可以保存角色变更');
        return;
      }
      if (!this.form.key || !this.form.name) {
        this.$message.error('请填写 key 和名称');
        return;
      }
      this.saving = true;
      try {
        const url = this.isCreate ? '/api/auth/createRole' : '/api/auth/updateRole';
        const res = await axios.post(url, {
          key: this.form.key,
          name: this.form.name,
          description: this.form.description,
          permissionKeys: this.form.permissionKeys,
        });
        if (res.status === 200) {
          this.$message.success('保存成功');
          this.$emit('saved');
          this.visible = false;
        } else {
          this.$message.error(res.data && res.data.message || '保存失败');
        }
      } catch (e) {
        this.$message.error(e.message || '保存失败');
      } finally {
        this.saving = false;
      }
    },
  },
};
</script>

<style scoped>
.role-editor-body {
  max-height: calc(100vh - 220px);
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
}

.role-editor-form :deep(.el-form-item__content) {
  min-width: 0;
}

.permission-form-item :deep(.el-select__wrapper) {
  min-height: 32px;
}

.permission-form-item :deep(.el-select__tags-text) {
  max-width: 180px;
}

@media (max-width: 768px) {
  .role-editor-dialog :deep(.el-dialog) {
    width: calc(100vw - 24px) !important;
  }

  .role-editor-form {
    --el-form-label-width: 82px;
  }
}
</style>
