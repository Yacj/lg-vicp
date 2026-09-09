<script setup lang="ts">
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { createProductSeries, updateProductSeries } from '@/api/modules/masterdata'
import type { ProductSeries, ProductSeriesInput } from '@/types/masterdata'
import { evidenceLevelLabels } from '@/utils/professional-status'

/**
 * 产品系列新增 / 编辑表单弹窗。
 * 列表面板与产品详情工作台共用，提交成功后由父级决定刷新动作。
 */
const emit = defineEmits<{
  saved: []
}>()

const drawer = useCrudDrawer<ProductSeriesInput, ProductSeries>({
  createForm: () => ({
    code: '',
    name: '',
    description: '',
    changeNote: '',
    evidenceSource: '',
    evidenceRef: '',
    evidenceLevel: undefined,
  }),
  editForm: (entity) => ({
    code: entity.code,
    name: entity.name,
    description: entity.description ?? '',
    changeNote: '',
    evidenceSource: entity.evidenceSource ?? '',
    evidenceRef: entity.evidenceRef ?? '',
    evidenceLevel: entity.evidenceLevel ?? undefined,
  }),
  submit: async ({ mode, data, entity }) => {
    const input = {
      ...data,
      description: data.description || undefined,
      changeNote: data.changeNote || undefined,
      evidenceSource: data.evidenceSource || undefined,
      evidenceRef: data.evidenceRef || undefined,
      evidenceLevel: data.evidenceLevel ?? undefined,
    }
    const result = mode === 'create'
      ? await createProductSeries(input)
      : await updateProductSeries(entity!.id, input)
    return result
  },
  onSuccess: () => emit('saved'),
})

defineExpose({
  openCreate: drawer.openCreate,
  openEdit: drawer.openEdit,
})
</script>

<template>
  <AppCrudFormDialog
    :columns="2"
    :form-data="drawer.formData"
    :mode="drawer.mode.value"
    :submitting="drawer.isSubmitting.value"
    :title="drawer.mode.value === 'create' ? '新增产品系列' : '编辑产品系列'"
    :visible="drawer.visible.value"
    :width="'min(720px, 92vw)'"
    @cancel="drawer.close"
    @submit="drawer.submit"
    @update:visible="drawer.setVisible"
  >
    <t-form-item label="系列编码" name="code" required-mark>
      <t-input v-model="drawer.formData.code" maxlength="80" placeholder="唯一逻辑键" />
    </t-form-item>
    <t-form-item label="系列名称" name="name" required-mark>
      <t-input v-model="drawer.formData.name" maxlength="160" placeholder="请输入系列名称" />
    </t-form-item>
    <t-form-item label="资料可信度" name="evidenceLevel">
      <t-select
        v-model="drawer.formData.evidenceLevel"
        :options="[
          { label: evidenceLevelLabels.A, value: 'A' },
          { label: evidenceLevelLabels.B, value: 'B' },
          { label: evidenceLevelLabels.C, value: 'C' },
        ]"
        clearable
        placeholder="选填"
      />
    </t-form-item>
    <t-form-item label="资料出处" name="evidenceSource">
      <t-input v-model="drawer.formData.evidenceSource" maxlength="500" placeholder="如：产品标准、企业样本" />
    </t-form-item>
    <t-form-item label="页码 / 条款" name="evidenceRef">
      <t-input v-model="drawer.formData.evidenceRef" maxlength="120" placeholder="选填" />
    </t-form-item>
    <t-form-item v-if="drawer.mode.value === 'edit'" label="变更说明" name="changeNote">
      <t-input v-model="drawer.formData.changeNote" maxlength="2000" placeholder="本次修改内容（可选）" />
    </t-form-item>
    <t-form-item class="vicp-form-wide" label="描述" name="description">
      <t-textarea v-model="drawer.formData.description" :autosize="{ minRows: 2, maxRows: 4 }" maxlength="2000" placeholder="选填" />
    </t-form-item>
  </AppCrudFormDialog>
</template>

<style scoped>
.vicp-form-wide {
  grid-column: 1 / -1;
}
</style>
