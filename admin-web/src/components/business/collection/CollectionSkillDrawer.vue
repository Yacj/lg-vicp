<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, ref, watch } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { createCollectionSkill, fetchCollectionSkills, updateCollectionSkill } from '@/api/modules/collection'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import type { AppTableAction } from '@/types/crud'
import type { CollectionSkill, CollectionSkillInput } from '@/types/collection'
import { COLLECTION_PERMISSIONS } from '@/types/collection'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
  changed: []
}>()

const { canAccess } = usePermissionAccess()
const feedback = useAppFeedback()
const canCreate = computed(() => canAccess({ permissions: [COLLECTION_PERMISSIONS.SKILL_CREATE] }))
const canUpdate = computed(() => canAccess({ permissions: [COLLECTION_PERMISSIONS.SKILL_UPDATE] }))

const skills = ref<CollectionSkill[]>([])
const loading = ref(false)
const error = ref<unknown>(null)

interface SkillForm extends Record<string, unknown> {
  name: string
  keywords: string
  instruction: string
  enabled: boolean
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await fetchCollectionSkills()
    skills.value = result.items
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    loading.value = false
  }
}

watch(() => props.visible, (visible) => {
  if (visible) {
    void load()
  }
})

const drawer = useCrudDrawer<SkillForm, CollectionSkill, CollectionSkill>({
  createForm: () => ({ enabled: true, instruction: '', keywords: '', name: '' }),
  editForm: entity => ({
    enabled: entity.enabled,
    instruction: entity.instruction ?? '',
    keywords: entity.keywordsJson.join('\n'),
    name: entity.name,
  }),
  onError: cause => void feedback.messageError(cause),
  onSuccess: async () => {
    await feedback.message('success', '采集技能已保存')
    await load()
    emit('changed')
  },
  submit: ({ data, entity, mode }) => {
    const input: CollectionSkillInput = {
      enabled: data.enabled,
      instruction: data.instruction.trim() || undefined,
      keywordsJson: data.keywords.split(/[\n,，]/).map(item => item.trim()).filter(Boolean),
      name: data.name.trim(),
    }
    return mode === 'create' ? createCollectionSkill(input) : updateCollectionSkill(entity!.id, input)
  },
})

const rules: FormRules<SkillForm> = {
  name: [{ required: true, message: '请输入技能名称' }],
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', minWidth: 140, title: 'Skill 名称' },
  {
    colKey: 'keywordsJson',
    ellipsis: true,
    minWidth: 200,
    title: '关键词',
    cell: (_, { row }) => (row as CollectionSkill).keywordsJson.join('、') || '—',
  },
  {
    colKey: 'instruction',
    ellipsis: true,
    minWidth: 200,
    title: '说明',
    cell: (_, { row }) => (row as CollectionSkill).instruction || '—',
  },
  {
    colKey: 'enabled',
    title: '状态',
    width: 90,
    cell: (_, { row }) => h(AppStatusTag, {
      label: (row as CollectionSkill).enabled ? '启用' : '停用',
      status: (row as CollectionSkill).enabled ? 'success' : 'disabled',
    }),
  },
]

function getActions(row: TableRowData): AppTableAction[] {
  if (!canUpdate.value) {
    return []
  }
  return [{ handler: () => drawer.openEdit(row as CollectionSkill), key: 'edit', label: '编辑' }]
}
</script>

<template>
  <t-drawer
    :footer="false"
    header="采集 Skill"
    size="min(720px, 96vw)"
    :visible="visible"
    @close="emit('close')"
    @update:visible="(value: boolean) => { if (!value) emit('close') }"
  >
    <AppDataTable
      :columns="columns"
      :data="skills"
      empty-description="可新增关键词技能，供自动采集绑定"
      empty-title="暂无 Skill"
      :error-description="error ? normalizeFeedbackError(error).message : '请检查网络连接后重试'"
      :show-pagination="false"
      row-key="id"
      :status="loading ? 'loading' : error ? 'error' : 'ready'"
      :total="skills.length"
      @refresh="load"
      @retry="load"
    >
      <template #toolbar>
        <t-button v-if="canCreate" theme="primary" @click="drawer.openCreate">
          <template #icon>
            <AddIcon />
          </template>
          新增 Skill
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :form-data="drawer.formData"
      :mode="drawer.mode.value"
      :rules="rules"
      :submitting="drawer.isSubmitting.value"
      :title="drawer.mode.value === 'create' ? '新增 Skill' : '编辑 Skill'"
      :visible="drawer.visible.value"
      width="min(520px, 92vw)"
      @cancel="drawer.close"
      @submit="drawer.submit"
      @update:visible="drawer.setVisible"
    >
      <t-form-item label="Skill 名称" name="name" required-mark>
        <t-input v-model="drawer.formData.name" maxlength="160" placeholder="如：安徽地方标准" />
      </t-form-item>
      <t-form-item label="关键词" name="keywords">
        <t-textarea
          v-model="drawer.formData.keywords"
          :autosize="{ minRows: 3, maxRows: 6 }"
          placeholder="每行一个关键词，或用逗号分隔"
        />
      </t-form-item>
      <t-form-item label="简单说明" name="instruction">
        <t-textarea v-model="drawer.formData.instruction" :autosize="{ minRows: 3, maxRows: 6 }" maxlength="4000" placeholder="选填" />
      </t-form-item>
      <t-form-item label="启用状态" name="enabled">
        <t-switch v-model="drawer.formData.enabled" />
      </t-form-item>
    </AppCrudFormDialog>
  </t-drawer>
</template>
