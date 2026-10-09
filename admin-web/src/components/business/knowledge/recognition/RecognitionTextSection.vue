<script setup lang="ts">
withDefaults(defineProps<{ readonly?: boolean }>(), { readonly: false })

/** 识别草稿正文：页面全文（用于页面分块与检索）。 */
const fullText = defineModel<string>('fullText', { default: '' })
</script>

<template>
  <t-form class="recognition-text" label-align="top">
    <t-form-item label="页面全文">
      <t-textarea
        v-model="fullText"
        :autosize="{ minRows: 4, maxRows: 10 }"
        :disabled="readonly"
        placeholder="AI 识别出的页面文字，可在确认前人工修正"
      />
    </t-form-item>
  </t-form>
</template>
