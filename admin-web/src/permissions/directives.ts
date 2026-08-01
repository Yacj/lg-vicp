import type { DirectiveBinding, ObjectDirective } from 'vue'
import { useUserStore } from '@/stores/user'

export type PermissionDirectiveValue = string | string[]

const originalDisplay = new WeakMap<HTMLElement, string>()

function normalizeRequired(value: PermissionDirectiveValue): string[] {
  return Array.isArray(value) ? value : [value]
}

function applyPermission(
  element: HTMLElement,
  binding: DirectiveBinding<PermissionDirectiveValue>,
): void {
  const userStore = useUserStore()
  const required = normalizeRequired(binding.value)
  const allowed = binding.modifiers.all
    ? userStore.hasAllPermissions(required)
    : userStore.hasAnyPermission(required)

  if (!originalDisplay.has(element)) {
    originalDisplay.set(element, element.style.display)
  }
  element.style.display = allowed ? originalDisplay.get(element) ?? '' : 'none'
}

export const permissionDirective: ObjectDirective<HTMLElement, PermissionDirectiveValue> = {
  mounted: applyPermission,
  updated: applyPermission,
}
