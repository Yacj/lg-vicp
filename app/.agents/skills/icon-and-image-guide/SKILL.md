---
name: icon-and-image-guide
description: 指导 uni-app 项目中图标、SVG、图片和 iconfont 的选择与使用。用户询问 icon、图标、SVG、图片、Logo、Banner、iconfont、UnoCSS presetIcons、本地 SVG collection 或静态资源时使用。
---

# Icon And Image Guide

用于统一图标、SVG、图片资源的选择和落位。核心原则：图标表达动作/状态/导航语义，图片表达品牌/内容/运营视觉；新功能优先使用 UnoCSS 图标方案，iconfont 仅兼容存量。

## 资源选择规则

| 资源类型 | 首选方式 | 适用场景 |
|---|---|---|
| 单色功能图标 | UnoCSS `presetIcons` + 本地 SVG collection | 按钮、导航、状态、列表入口、操作图标 |
| Wot UI 内置图标 | `wd-icon` 或组件自带 icon prop | Wot UI 组件原生支持的图标位 |
| 历史字体图标 | `src/styles/iconfont.css` | 存量 iconfont 迁移或临时兼容 |
| 多色 SVG / Logo | `src/static` 静态图片 | 品牌 Logo、多色图形、复杂插图 |
| PNG/JPG/WebP | `src/static` 静态图片 | Banner、照片、运营图、内容图片 |

不要把多色插图、Logo、Banner 放进图标 collection；也不要用图片资源替代可主题化的单色功能图标。

## 本地 SVG 图标 collection

当前项目约定：

```txt
src/static/my-icons/{name}.svg
```

`uno.config.ts` 中 collection 名称为 `my-icons`，使用类名：

```txt
i-my-icons-{name}
```

示例：

```vue
<template>
  <view class="flex items-center gap-2 text-primary">
    <text class="i-my-icons-scan-code text-5" />
    <text>扫码</text>
  </view>
</template>
```

### SVG 文件要求

- 文件名使用 kebab-case，例如 `scan-code.svg`、`arrow-left.svg`。
- 一个文件只表达一个图标语义。
- 单色图标优先使用 `currentColor`。
- 避免保留固定 `width` / `height` 导致图标尺寸不可控；项目配置会尽量转换为 `1em`。
- 复杂多色 SVG 不建议进入 `my-icons`，应作为图片放在 `src/static`。

## Wot UI 图标

如果是 Wot UI 组件已有的图标能力，优先使用组件 API：

```vue
<template>
  <wd-icon name="search" size="20px" />
  <wd-button icon="add">新增</wd-button>
</template>
```

规则：

- 组件内置图标位优先用组件 prop，不额外包一层自定义图标。
- 业务专属图标或设计自定义图标使用本地 SVG collection。

## iconfont 兼容策略

`src/styles/iconfont.css` 只用于兼容存量字体图标。新功能不优先新增 iconfont。

如必须使用：

1. 在 `src/styles/index.scss` 中引入：

```scss
@import './iconfont.css';
```

2. 页面使用：

```vue
<template>
  <text class="iconfont icon-chat" />
</template>
```

限制：

- 不适合多色图标。
- 不适合高频新增业务图标。
- 字体图标命名和语义较弱，迁移时优先转成本地 SVG collection。

## 静态图片和 SVG 图片

Logo、插图、Banner、多色 SVG、PNG/JPG/WebP 放在 `src/static`。

示例：

```vue
<template>
  <image src="/static/logo.svg" class="h-16 w-16" mode="aspectFit" />
</template>
```

使用建议：

- Logo 和多色插图不要转成 UnoCSS 图标。
- 大图优先压缩，避免影响小程序和 App 包体积。
- 装饰图和运营图应明确尺寸、裁剪模式和兜底背景。
- 跨端页面优先使用 `image`，不要依赖 Web 专属的 `img`。

## 组件封装建议

当图标/图片使用开始重复时，优先封装组件而不是到处散写资源路径。

推荐方向：

```txt
src/components/AppIcon.vue
src/components/AppImage.vue
```

`AppIcon` 可统一处理：

- collection 名称
- 默认尺寸
- 颜色继承
- 兜底图标
- `wd-icon` 和本地 SVG 图标的选择

`AppImage` 可统一处理：

- `mode`
- loading / error 占位
- 圆角和背景
- 静态资源路径约定

## 决策流程

```txt
需要一个视觉资源
  ↓
它表达动作、状态、导航吗？是 → 图标
  ↓ 否
它表达品牌、内容、运营或装饰吗？是 → 图片

图标
  ↓
Wot UI 组件已内置？是 → 用组件 API
  ↓ 否
是否单色且需要跟随主题？是 → my-icons + UnoCSS
  ↓ 否
是否存量 iconfont？是 → iconfont 兼容
  ↓ 否
作为静态图片处理
```

## 修改检查清单

新增或修改图标/图片时检查：

- [ ] 是否选择了正确的资源类型。
- [ ] 本地 SVG 图标是否放在 `src/static/my-icons`。
- [ ] SVG 文件名是否为 kebab-case。
- [ ] 单色 SVG 是否支持 `currentColor`。
- [ ] 多色 SVG / Logo 是否没有误放进图标 collection。
- [ ] 新功能是否避免新增 iconfont。
- [ ] 页面是否避免硬编码重复资源路径，必要时封装组件。