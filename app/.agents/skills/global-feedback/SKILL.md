---
name: global-feedback
description: 全局反馈组件（Toast/Dialog/Loading）使用指南
---

# 全局反馈组件

项目提供了全局 Toast、Dialog、Loading 组件，基于 Pinia 状态管理，支持跨页面调用。

## 组件列表

| 组件 | 用途 | Composable |
|------|------|------------|
| GlobalToast | 轻提示 | `useGlobalToast()` |
| GlobalDialog | 确认弹窗 / 提醒弹窗 / 输入弹窗 | `useGlobalDialog()` |
| GlobalLoading | 加载状态 | `useGlobalLoading()` |

## 使用原则

- 轻提示不要直接使用 `uni.showToast`，统一使用 `useGlobalToast()`。
- 确认、提醒、输入类弹窗统一使用 `useGlobalDialog()`。
- 异步加载状态统一使用 `useGlobalLoading()`。
- 三类组件已在 `src/App.ku.vue` 中挂载，业务页面通常只需要调用 composable。

## useGlobalToast

### 基础用法

```typescript
const { show, success, error, info, warning, close } = useGlobalToast()

show('这是一条提示')
success('操作成功')
error('操作失败')
info('提示信息')
warning('警告信息')
close()
```

### 自定义配置

```typescript
show({
  msg: '自定义提示',
  duration: 3000,
  iconName: 'success',
  position: 'middle',
  direction: 'vertical',
})
```

## useGlobalDialog

### 确认弹窗

```typescript
const { confirm } = useGlobalDialog()

confirm({
  title: '提示',
  msg: '确定要删除吗？',
  confirmButtonText: '确定',
  cancelButtonText: '取消',
  success() {
    console.log('用户点击确定')
  },
  fail() {
    console.log('用户点击取消')
  },
})
```

### 提醒弹窗

```typescript
const { alert } = useGlobalDialog()

alert({
  title: '操作完成',
  msg: '数据已经保存',
})
```

### 与 Promise 结合

```typescript
function confirmDelete() {
  const { confirm } = useGlobalDialog()

  return new Promise<void>((resolve, reject) => {
    confirm({
      title: '确认删除',
      msg: '删除后无法恢复',
      success: () => resolve(),
      fail: () => reject(new Error('用户取消删除')),
    })
  })
}

try {
  await confirmDelete()
  // 用户确认，执行删除
}
catch {
  // 用户取消
}
```

## useGlobalLoading

### 基础用法

```typescript
const { show, hide } = useGlobalLoading()

show()
show('加载中...')
hide()
```

### 包装异步操作

```typescript
async function fetchData() {
  const { show, hide } = useGlobalLoading()

  show('数据加载中...')
  try {
    const data = await api.getData()
    return data
  }
  finally {
    hide()
  }
}
```

## 在路由守卫中使用

```typescript
// src/router/index.ts
router.beforeEach((to, from, next) => {
  if (to.name === 'protected-page') {
    const { confirm } = useGlobalDialog()

    return new Promise<void>((resolve, reject) => {
      confirm({
        title: '需要登录',
        msg: '是否前往登录？',
        success() {
          next({ name: 'login' })
          resolve()
        },
        fail() {
          next(false)
          reject(new Error('用户取消登录跳转'))
        },
      })
    })
  }

  next()
})
```

## 组件配置

全局组件已在 `src/App.ku.vue` 中配置：

```vue
<template>
  <wd-config-provider>
    <ku-root-view />
    <global-loading />
    <global-toast />
    <global-dialog />
  </wd-config-provider>
</template>
```

## 注意事项

- 这些 composable 基于 Pinia Store 实现。
- 支持跨页面调用，组件会记录触发时的当前页面。
- 已配置自动导入，业务代码通常无需手动 import。
- 同一类型反馈同时只显示一个实例，新调用会覆盖前一次状态。