---
name: app-platform-guide
description: uni-app App 端开发指南，覆盖 APP-PLUS、Android/iOS 差异、权限、隐私协议、安全区、返回键、App 更新、原生插件、manifest.json 和真机验证。用户提到 App、Android、iOS、APP-PLUS、原生能力、权限、打包、上架或平台差异时使用。
---

# App Platform Guide

用于处理 uni-app App 端开发。目标是控制平台差异复杂度：页面表达业务意图，平台能力集中封装，权限和隐私先行，App 端能力必须真机验证。

## 适用场景

用户提到以下内容时使用本 skill：

- App、Android、iOS、`APP-PLUS`、真机调试、App 打包或上架。
- 相机、相册、扫码、定位、蓝牙、文件、麦克风、通知、推送、分享、支付、设备信息。
- `manifest.json`、权限配置、隐私协议、原生插件、第三方 SDK。
- H5 / 小程序 / App 行为不一致，或 Android / iOS 行为不一致。

## 架构边界

- 页面只负责业务流程和交互，不直接堆叠原生 API 与大量条件编译。
- 原生能力优先封装到 `src/composables`、`src/utils/platform` 或 `src/services/app`。
- `src/App.vue` 负责 uni-app 生命周期与全局样式入口。
- `src/App.ku.vue` 负责根级 UI 挂载，例如 `wd-config-provider`、全局反馈组件、隐私弹窗。
- 涉及权限、隐私、升级、推送、设备信息的逻辑不要散落在页面中。

推荐职责：

```txt
src/pages              页面交互和业务流程
src/composables        用户可感知能力，如 useAppPermission、useAppUpdate
src/utils/platform     平台判断、安全区、设备信息、条件分支
src/services/app       App 专属服务，如 update、permission、push、scanner
src/App.vue            启动生命周期、全局样式入口
src/App.ku.vue         根视图容器和根级 UI 挂载
```

## 条件编译规则

- 少量 UI 差异可以在 `.vue` 中使用条件编译。
- 原生 API 调用不要直接写在页面，优先封装到 service / composable。
- Android / iOS 差异必须集中到 adapter，页面只调用统一接口。
- 条件编译分支必须有默认降级路径，避免 H5 或小程序构建失败。

推荐封装：

```ts
export function getAppPlatform() {
  // #ifdef APP-PLUS
  return uni.getSystemInfoSync().platform
  // #endif

  return 'web'
}
```

页面使用：

```ts
const platform = getAppPlatform()
```

不建议页面里到处写：

```ts
// #ifdef APP-PLUS
// plus.android.requestPermissions(...)
// #endif
```

## 权限与隐私

涉及敏感能力时必须遵循：

```txt
解释用途 → 检查权限 → 请求权限 → 成功后执行业务 → 拒绝时给出设置引导
```

重点权限：

- 相机：扫码、拍照、OCR。
- 相册：图片选择、图片保存。
- 定位：地图、附近门店、配送地址。
- 麦克风：录音、语音输入、音视频。
- 通知：推送、消息提醒。
- 蓝牙：硬件设备连接。
- 文件：导入、导出、下载、分享。

隐私规则：

- 用户同意隐私协议前，不初始化统计、推送、定位、设备标识、第三方登录等敏感 SDK。
- 已有 `PrivacyPopup` 时，优先复用根层隐私弹窗，不要在业务页面重复造弹窗。
- 新增第三方 SDK 时必须说明采集内容、触发时机和用户授权关系。

## App 启动流程

App 初始化建议按阶段拆分：

```txt
应用启动
  ↓
读取本地持久化状态
  ↓
确认隐私协议状态
  ↓
初始化非敏感全局能力
  ↓
用户同意隐私协议后初始化敏感 SDK
  ↓
检查 App 更新、推送注册或业务启动任务
```

规则：

- 启动流程可以放在 `src/App.vue` 或专门的 startup composable 中。
- 根级 UI 挂载放在 `src/App.ku.vue`。
- 页面不要承担 App 初始化职责。

## 安全区与布局

App 端优先在布局层处理安全区和状态栏：

- 不要在页面中硬编码状态栏高度、底部安全区高度。
- 自定义导航栏、沉浸式状态栏、TabBar 底部安全区应优先放在 `src/layouts` 或 composable。
- 页面只消费布局提供的空间，不直接重复计算设备安全区。

推荐封装方向：

```txt
src/composables/useSafeArea.ts
src/layouts/default.vue
src/layouts/tabbar.vue
```

## Android 返回键

返回键按状态优先级处理：

```txt
按返回键
  ↓
存在弹窗 / popup / action sheet？是 → 关闭浮层
  ↓ 否
存在未保存表单？是 → 确认离开
  ↓ 否
当前是首页或 TabBar 根页？是 → 二次确认退出 App
  ↓ 否
router.back()
```

规则：

- 弹层存在时，返回键优先关闭弹层，不直接退出页面。
- 表单存在未保存状态时，必须确认离开。
- TabBar 根页不要直接退出，使用二次确认或业务指定策略。

## App 更新

更新能力应集中封装，不要散落在页面：

```txt
src/services/app/update.ts
src/composables/useAppUpdate.ts
```

判断维度：

- Android：APK 下载、安装引导、强制更新 / 可选更新。
- iOS：跳转 App Store 或企业分发页面。
- 热更新 / wgt：仅在项目明确采用时接入。
- 更新弹窗使用全局 Dialog 或专用根层组件。

## 原生插件与第三方 SDK

引入前必须确认：

1. H5 / 小程序是否需要降级方案。
2. Android / iOS 是否都支持。
3. 是否需要权限。
4. 是否涉及隐私协议和用户同意。
5. 是否需要修改 `manifest.json`。
6. 是否影响证书、云打包、离线打包或上架审核。

适用对象：地图、推送、支付、分享、统计、登录、蓝牙、扫码、OCR、IM 等。

## manifest.json 修改规则

`manifest.json` 是 App 端高风险配置文件：

- 不随便改 `appid`、包名、版本号、权限、SDK 配置。
- 新增权限必须说明业务原因和触发场景。
- 新增 SDK 必须说明隐私影响和初始化时机。
- 修改前必须判断影响范围：H5、小程序、App、Android、iOS。

## 构建与验证

常用命令：

```bash
pnpm dev:app
pnpm dev:app-android
pnpm dev:app-ios
pnpm build:app
pnpm build:app-android
pnpm build:app-ios
```

验证规则：

- 涉及 `APP-PLUS`、权限、原生插件、返回键、安全区、设备信息时，不能只用 H5 验证。
- Android / iOS 行为可能不同，涉及原生能力时需要分别验证。
- 权限拒绝、二次拒绝、系统设置关闭权限都要覆盖。

## 输出要求

处理 App 端任务时，回答或实现必须明确：

- 目标平台：Android、iOS、App 全端，还是同时兼容 H5 / 小程序。
- 涉及的权限和隐私影响。
- 条件编译边界放在哪里。
- 页面、composable、service、manifest 的职责分配。
- 需要真机验证的点。