<script setup lang="ts">
import type { RecognitionDraftSystem } from '@/components/business/knowledge/recognition/types'
import { SPEC_CLASS_OPTIONS } from '@/components/business/knowledge/recognition/types'

withDefaults(defineProps<{ readonly?: boolean }>(), { readonly: false })

/**
 * 识别草稿热工结构编辑：构造块 / 构造层 / 参考方案。
 * 只负责「AI 结果」的修正，正式数据映射由 RecognitionMappingSection 承担。
 */
const systems = defineModel<RecognitionDraftSystem[]>('systems', { required: true })

function addSystem(): void {
  systems.value = [...systems.value, { systemName: '', constructionCode: '', baseMaterial: '', layers: [], options: [] }]
}

function removeSystem(index: number): void {
  systems.value = systems.value.filter((_, itemIndex) => itemIndex !== index)
}

function addLayer(system: RecognitionDraftSystem): void {
  system.layers.push({ name: '' })
}

function removeLayer(system: RecognitionDraftSystem, index: number): void {
  system.layers.splice(index, 1)
}

function addOption(system: RecognitionDraftSystem): void {
  system.options.push({})
}

function removeOption(system: RecognitionDraftSystem, index: number): void {
  system.options.splice(index, 1)
}
</script>

<template>
  <div class="recognition-thermal">
    <section
      v-for="(system, systemIndex) in systems"
      :key="systemIndex"
      class="recognition-thermal__system"
    >
      <header class="recognition-thermal__system-head">
        <strong>构造 {{ system.constructionCode || `#${systemIndex + 1}` }}</strong>
        <t-button
          v-if="!readonly"
          size="small"
          theme="danger"
          variant="text"
          @click="removeSystem(systemIndex)"
        >
          删除构造
        </t-button>
      </header>

      <t-form label-align="top">
        <div class="recognition-thermal__grid">
          <t-form-item label="体系">
            <t-input v-model="system.systemName" :disabled="readonly" />
          </t-form-item>
          <t-form-item label="规格类型">
            <t-select v-model="system.specClass" :disabled="readonly" :options="[...SPEC_CLASS_OPTIONS]" clearable />
          </t-form-item>
          <t-form-item label="构造编号">
            <t-input v-model="system.constructionCode" :disabled="readonly" />
          </t-form-item>
          <t-form-item label="基层材料">
            <t-input v-model="system.baseMaterial" :disabled="readonly" />
          </t-form-item>
          <t-form-item label="基层厚度">
            <t-input-number v-model="system.baseThicknessMm" :disabled="readonly" :min="0" />
          </t-form-item>
        </div>
      </t-form>

      <div class="recognition-thermal__subhead">
        <strong>构造层</strong>
        <t-button v-if="!readonly" size="small" variant="text" @click="addLayer(system)">
          新增一层
        </t-button>
      </div>
      <div
        v-for="(layer, layerIndex) in system.layers"
        :key="`layer-${layerIndex}`"
        class="recognition-thermal__row recognition-thermal__row--layer"
      >
        <label class="recognition-thermal__field recognition-thermal__field--name">
          <span>材料</span>
          <t-input v-model="layer.name" :disabled="readonly" placeholder="材料" />
        </label>
        <label class="recognition-thermal__field">
          <span>厚度 mm</span>
          <t-input-number v-model="layer.thicknessMm" :disabled="readonly" :min="0" placeholder="厚度" />
        </label>
        <label class="recognition-thermal__field">
          <span>λ</span>
          <t-input-number v-model="layer.lambda" :disabled="readonly" :min="0" placeholder="λ" />
        </label>
        <label class="recognition-thermal__field">
          <span>α</span>
          <t-input-number v-model="layer.alpha" :disabled="readonly" :min="0" placeholder="α" />
        </label>
        <label class="recognition-thermal__field">
          <span>热阻 R</span>
          <t-input-number v-model="layer.rValue" :disabled="readonly" :min="0" placeholder="R" />
        </label>
        <t-button v-if="!readonly" class="recognition-thermal__remove" theme="danger" variant="text" @click="removeLayer(system, layerIndex)">
          删除
        </t-button>
      </div>

      <div class="recognition-thermal__subhead">
        <strong>参考方案</strong>
        <t-button v-if="!readonly" size="small" variant="text" @click="addOption(system)">
          新增方案
        </t-button>
      </div>
      <div
        v-for="(option, optionIndex) in system.options"
        :key="`option-${optionIndex}`"
        class="recognition-thermal__row recognition-thermal__row--option"
      >
        <label class="recognition-thermal__field">
          <span>厚度 mm</span>
          <t-input-number v-model="option.thicknessMm" :disabled="readonly" :min="0" placeholder="厚度 mm" />
        </label>
        <label class="recognition-thermal__field">
          <span>产品层 R</span>
          <t-input-number v-model="option.productThermalResistance" :disabled="readonly" :min="0" placeholder="产品层 R" />
        </label>
        <label class="recognition-thermal__field">
          <span>总 R</span>
          <t-input-number v-model="option.totalThermalResistance" :disabled="readonly" :min="0" placeholder="总 R" />
        </label>
        <label class="recognition-thermal__field">
          <span>传热系数 K</span>
          <t-input-number v-model="option.kValue" :disabled="readonly" :min="0" placeholder="K" />
        </label>
        <t-button v-if="!readonly" class="recognition-thermal__remove" theme="danger" variant="text" @click="removeOption(system, optionIndex)">
          删除
        </t-button>
      </div>
    </section>

    <t-button v-if="!readonly" variant="outline" @click="addSystem">
      新增构造块
    </t-button>
  </div>
</template>

<style scoped>
.recognition-thermal {
  display: grid;
  gap: 12px;
  container-type: inline-size;
}

.recognition-thermal__system {
  padding: 12px;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
}

.recognition-thermal__system-head,
.recognition-thermal__subhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.recognition-thermal__system-head {
  margin-bottom: 8px;
}

.recognition-thermal__subhead {
  margin: 12px 0 8px;
}

.recognition-thermal__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.recognition-thermal__row {
  display: grid;
  align-items: end;
  gap: 8px;
  margin-bottom: 12px;
}

.recognition-thermal__row--layer {
  grid-template-columns: minmax(140px, 1.4fr) repeat(4, minmax(115px, 1fr)) auto;
}

.recognition-thermal__row--option {
  grid-template-columns: repeat(4, minmax(120px, 1fr)) auto;
}

.recognition-thermal__field {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.recognition-thermal__field span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.recognition-thermal__field :deep(.t-input),
.recognition-thermal__field :deep(.t-input-number) {
  width: 100%;
  min-width: 0;
}

@container (max-width: 820px) {
  .recognition-thermal__row--layer,
  .recognition-thermal__row--option {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .recognition-thermal__field--name {
    grid-column: 1 / -1;
  }

  .recognition-thermal__remove {
    grid-column: 1 / -1;
    justify-self: end;
  }
}

@container (max-width: 640px) {
  .recognition-thermal__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
