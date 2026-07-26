---
name: uni-page-generator
description: 基于项目规范快速生成 uni-app 页面
---

# uni-app 页面生成器

快速创建符合当前项目规范的 uni-app 页面。项目使用 `vite-plugin-uni-pages` 基于文件生成路由，并通过 `definePage` 写页面元信息。

## 使用场景

- 创建主包页面：`src/pages/{name}/index.vue`
- 创建 TabBar 页面：`src/pages/{name}/index.vue`，并使用 `layout: 'tabbar'`
- 创建分包页面：仅在明确启用分包时使用 `src/subPages/{name}/index.vue`

## 页面落位策略

默认不要主动创建分包。先按以下规则判断页面位置：

1. **TabBar 页面**
   - 放在 `src/pages/{name}/index.vue`
   - 使用 `layout: 'tabbar'`
   - 适合首页、我的、设置等一级入口页面

2. **普通主包页面**
   - 默认放在 `src/pages/{name}/index.vue`
   - 使用 `layout: 'default'`
   - 适合登录、详情、表单、列表、业务入口等通用页面

3. **分包页面**
   - 只有满足下面条件时，才放到 `src/subPages/{name}/index.vue`
   - 必须确认 `vite.config.ts` 的 `UniHelperPages({ subPackages })` 已注册对应分包根目录，例如 `subPackages: ['src/subPages']`
   - 必须确认用户明确要求启用分包，或当前项目已经存在并使用 `src/subPages`

## 什么时候建议启用分包

分包是体积和加载边界，不是默认目录分类。建议在这些场景使用：

- 小程序主包体积接近平台限制，需要拆出低频页面。
- 页面依赖明显更重，例如图表、富文本、地图、编辑器、复杂报表。
- 页面属于低频业务流，例如协议、帮助中心、演示页、管理页、营销活动页。
- 页面与主流程弱关联，可以接受首次进入时额外加载分包。

不建议分包的场景：

- 首页、TabBar、登录、核心交易链路等高频入口。
- 页面很轻，拆分只会增加路由和构建复杂度。
- 当前 `vite.config.ts` 里 `subPackages: []`，且用户没有明确要求开启分包。

## 启用分包前检查

创建分包页面前必须检查：

1. `src/subPages` 是否已经存在。
2. `vite.config.ts` 中 `UniHelperPages` 是否配置了对应 `subPackages`。
3. 页面是否真的属于低频、重依赖或可延迟加载的业务边界。
4. 用户是否明确接受新增分包目录和配置改动。

如果以上条件不满足，优先生成主包页面。

## 页面模板

### 基础页面

```vue
<script setup lang="ts">
definePage({
  name: '页面名称',
  layout: 'default',
  style: {
    navigationBarTitleText: '页面标题',
  },
})

const router = useRouter()
</script>

<template>
  <view class="p-3">
    <!-- 页面内容 -->
  </view>
</template>
```

### TabBar 页面

```vue
<script setup lang="ts">
definePage({
  name: 'home',
  layout: 'tabbar',
  style: {
    navigationBarTitleText: '首页',
  },
})
</script>

<template>
  <view class="box-border py-3">
    <!-- TabBar 页面内容 -->
  </view>
</template>
```

## 推荐目录结构

### 当前最小结构

```
src/
├── pages/
│   ├── index/
│   │   └── index.vue
│   └── about/
│       └── index.vue
└── layouts/
    ├── default.vue
    └── tabbar.vue
```

### 明确启用分包后的结构

```
src/
├── pages/              # 主包页面：高频入口、核心链路、TabBar
│   ├── index/
│   │   └── index.vue
│   └── about/
│       └── index.vue
└── subPages/           # 分包页面：低频、重依赖、可延迟加载
    ├── report/
    │   └── index.vue
    └── help/
        └── index.vue
```

## 创建步骤

1. **确定页面类型**
   - TabBar 页面 → `src/pages/{name}/index.vue`
   - 普通页面 → 默认 `src/pages/{name}/index.vue`
   - 分包页面 → 确认启用分包后再使用 `src/subPages/{name}/index.vue`

2. **使用 definePage 宏**
   - 配置 `name` 用于编程式导航
   - 配置 `layout` 选择布局
   - 配置 `style` 设置导航栏

3. **页面跳转**

```typescript
const router = useRouter()

// 使用 name 跳转
router.push({ name: 'detail' })

// 主包路径跳转
router.push('/pages/detail/index')

// 分包路径跳转，仅在已启用分包时使用
router.push('/subPages/report/index')

// 带参数跳转
router.push({ name: 'detail', query: { id: '123' } })
```

## 注意事项

- 页面文件名固定为 `index.vue`。
- 优先使用 UnoCSS 原子化样式。
- 不要为了“分类好看”而创建分包；分包只服务体积、加载和业务边界。
- 如果新增 `src/subPages`，必须同步更新 `vite.config.ts` 的 `subPackages` 配置。