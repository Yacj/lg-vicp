<script setup lang="ts">
withDefaults(defineProps<{ readonly?: boolean }>(), { readonly: false })
/** 识别草稿基础信息：资料页码 / 页面标题。 */
const pageLabel = defineModel<string>('pageLabel', { default: '' })
const pageTitle = defineModel<string>('pageTitle', { default: '' })
</script>

<template>
  <t-form class="recognition-basic" label-align="top">
    <div class="recognition-basic__grid">
      <t-form-item label="资料页码">
        <t-input v-model="pageLabel" :disabled="readonly" maxlength="32" placeholder="如 A1、21" />
      </t-form-item>
      <t-form-item label="页面标题">
        <t-input v-model="pageTitle" :disabled="readonly" maxlength="255" placeholder="请输入页面标题" />
      </t-form-item>
    </div>
  </t-form>
</template>

<style scoped>
.recognition-basic__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 900px) {
  .recognition-basic__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
