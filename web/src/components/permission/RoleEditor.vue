<template>
  <el-dialog
    v-model="visible"
    :title="isCreate ? '新建角色' : `编辑角色：${form.key}`"
    width="640px"
    @closed="onClosed"
  >
    <el-form :model="form" label-width="100px">
      <el-form-item label="角色 key">
        <el-input v-model="form.key" :disabled="!isCreate" placeholder="role_setter (小写字母/数字/下划线)" />
      </el-form-item>
      <el-form-item label="名称">
        <el-input v-model="form.name" placeholder="出题人" />
      </el-form-item>
      <el-form-item label="说明">
        <el-input v-model="form.description" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item label="包含权限">
        <PermissionPicker
          v-model="form.permissionKeys"
          :permissions="permissions"
          multiple
          placeholder="勾选权限"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
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
