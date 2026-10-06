import { getPlatformInfo } from '@/services/platform'

export type MediaPermissionKind = 'camera' | 'album'

const USAGE: Record<MediaPermissionKind, string> = {
  camera: '用于拍摄施工节点图并发送给筑小格',
  album: '用于从相册选择图片并发送给筑小格',
}

const WECHAT_SCOPE: Record<MediaPermissionKind, string> = {
  camera: 'scope.camera',
  album: 'scope.writePhotosAlbum',
}

function openPermissionSettings() {
  uni.openSetting({})
}

function confirmOpenSettings(kind: MediaPermissionKind) {
  return new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '需要权限',
      content: `${USAGE[kind]}。请在设置中开启后重试。`,
      confirmText: '去设置',
      cancelText: '取消',
      success: (result) => {
        if (result.confirm) {
          openPermissionSettings()
        }
        resolve(false)
      },
      fail: () => resolve(false),
    })
  })
}

function authorizeWechat(kind: MediaPermissionKind) {
  const scope = WECHAT_SCOPE[kind]
  return new Promise<boolean>((resolve) => {
    uni.getSetting({
      success: (settings) => {
        const auth = settings.authSetting?.[scope as keyof UniApp.AuthSetting]
        if (auth === true) {
          resolve(true)
          return
        }
        if (auth === false) {
          void confirmOpenSettings(kind).then(resolve)
          return
        }
        uni.authorize({
          scope,
          success: () => resolve(true),
          fail: () => {
            void confirmOpenSettings(kind).then(resolve)
          },
        })
      },
      fail: () => resolve(true),
    })
  })
}

function requestAppPermissions(permissions: string[]) {
  return new Promise<boolean>((resolve) => {
    // #ifdef APP-PLUS
    const plusApp = (globalThis as { plus?: { android?: { requestPermissions?: (names: string[], success: (result: { granted: string[], deniedPresent: string[], deniedAlways: string[] }) => void, fail: () => void) => void } } }).plus
    if (!plusApp?.android?.requestPermissions) {
      resolve(true)
      return
    }
    plusApp.android.requestPermissions(
      permissions,
      (result) => {
        const denied = [...(result.deniedPresent || []), ...(result.deniedAlways || [])]
        resolve(denied.length === 0)
      },
      () => resolve(false),
    )
    return
    // #endif
    resolve(true)
  })
}

async function authorizeApp(kind: MediaPermissionKind) {
  const platform = getPlatformInfo().platform
  if (platform !== 'app') {
    return true
  }

  const permissions = kind === 'camera'
    ? ['android.permission.CAMERA']
    : [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.READ_MEDIA_IMAGES',
      ]

  const granted = await requestAppPermissions(permissions)
  if (granted) {
    return true
  }
  return confirmOpenSettings(kind)
}

/**
 * 解释用途 → 检查权限 → 请求权限 → 拒绝时引导去设置。
 * 页面只调用本方法，不直接写 plus / authorize。
 */
export async function ensureMediaPermission(kind: MediaPermissionKind) {
  const platform = getPlatformInfo().platform
  if (platform === 'mp-weixin') {
    if (kind === 'album') {
      return true
    }
    return authorizeWechat(kind)
  }
  if (platform === 'app') {
    return authorizeApp(kind)
  }
  return true
}
