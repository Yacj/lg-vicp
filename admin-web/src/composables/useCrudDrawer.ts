import { computed, reactive, readonly, ref, shallowRef, toRaw } from 'vue'
import type {
  CrudDrawerMode,
  CrudDrawerSubmitContext,
  CrudMutationStatus,
} from '@/types/crud'

export interface UseCrudDrawerOptions<
  TForm extends Record<string, unknown>,
  TEntity,
  TResult,
> {
  createForm: () => TForm
  editForm: (entity: TEntity) => TForm
  submit: (context: CrudDrawerSubmitContext<TForm, TEntity>) => Promise<TResult>
  closeOnSuccess?: boolean
  onError?: (error: unknown) => void
  onSuccess?: (result: TResult, context: CrudDrawerSubmitContext<TForm, TEntity>) => void | Promise<void>
}

export type CrudDrawerSubmitResult<TResult>
  = | { ok: false, reason: 'busy' | 'readonly' }
    | { ok: false, reason: 'error', error: unknown }
    | { ok: true, value: TResult }

export function useCrudDrawer<
  TForm extends Record<string, unknown>,
  TEntity,
  TResult = unknown,
>(options: UseCrudDrawerOptions<TForm, TEntity, TResult>) {
  const visible = ref(false)
  const mode = ref<CrudDrawerMode>('create')
  const entity = shallowRef<TEntity | null>(null)
  const formData = reactive(options.createForm()) as TForm
  const status = ref<CrudMutationStatus>('idle')
  const error = shallowRef<unknown>(null)

  const isSubmitting = computed(() => status.value === 'submitting')
  const isReadonly = computed(() => mode.value === 'view')

  function replaceForm(nextForm: TForm): void {
    Object.keys(formData).forEach(key => delete formData[key])
    Object.assign(formData, nextForm)
  }

  function begin(nextMode: CrudDrawerMode, nextEntity: TEntity | null, nextForm: TForm): void {
    mode.value = nextMode
    entity.value = nextEntity
    replaceForm(nextForm)
    status.value = 'idle'
    error.value = null
    visible.value = true
  }

  function openCreate(): void {
    begin('create', null, options.createForm())
  }

  function openEdit(nextEntity: TEntity): void {
    begin('edit', nextEntity, options.editForm(nextEntity))
  }

  function openView(nextEntity: TEntity): void {
    begin('view', nextEntity, options.editForm(nextEntity))
  }

  function close(): boolean {
    if (isSubmitting.value) {
      return false
    }
    visible.value = false
    return true
  }

  function setVisible(nextVisible: boolean): void {
    if (nextVisible) {
      visible.value = true
      return
    }
    close()
  }

  function resetForm(): void {
    replaceForm(entity.value === null ? options.createForm() : options.editForm(entity.value))
    status.value = 'idle'
    error.value = null
  }

  async function submit(): Promise<CrudDrawerSubmitResult<TResult>> {
    if (isSubmitting.value) {
      return { ok: false, reason: 'busy' }
    }
    const submitMode = mode.value
    if (submitMode === 'view') {
      return { ok: false, reason: 'readonly' }
    }

    const context: CrudDrawerSubmitContext<TForm, TEntity> = {
      mode: submitMode,
      data: { ...toRaw(formData) } as TForm,
      entity: entity.value,
    }
    status.value = 'submitting'
    error.value = null

    let result: TResult
    try {
      result = await options.submit(context)
    }
    catch (cause) {
      error.value = cause
      status.value = 'error'
      options.onError?.(cause)
      return { ok: false, reason: 'error', error: cause }
    }

    status.value = 'success'
    if (options.closeOnSuccess !== false) {
      visible.value = false
    }
    await options.onSuccess?.(result, context)
    return { ok: true, value: result }
  }

  return {
    close,
    entity: readonly(entity),
    error: readonly(error),
    formData,
    isReadonly,
    isSubmitting,
    mode: readonly(mode),
    openCreate,
    openEdit,
    openView,
    resetForm,
    setVisible,
    status: readonly(status),
    submit,
    visible: readonly(visible),
  }
}