export const WECHAT_PHONE_AUTH_DENIED_MESSAGE = '需要授权手机号才能使用微信快速登录'
export const WECHAT_LOGIN_FAILED_MESSAGE = '微信登录失败，请稍后重试'
export const WECHAT_UNSUPPORTED_MESSAGE = '当前环境不支持微信快速登录，请使用手机号密码登录'
export const AGREEMENT_REQUIRED_MESSAGE = '请先阅读并同意用户协议和隐私政策'
export const PASSWORD_NOT_SET_MESSAGE = '当前账号还没有设置登录密码'

/** 微信 loginCode / phoneCode 只存在于当次请求，禁止写入本地存储或 Pinia。 */
export const EPHEMERAL_WECHAT_CODE_FIELDS = ['loginCode', 'phoneCode'] as const

const AUTH_FAILURE_COPY: Record<string, string> = {
  WECHAT_LOGIN_CODE_INVALID: '微信登录凭证无效或已过期，请重新授权',
  WECHAT_PHONE_CODE_INVALID: '微信手机号授权无效或已过期，请重新授权',
  WECHAT_API_ERROR: '微信服务暂时不可用，请稍后重试',
  USER_DISABLED: '账号已被禁用',
  PHONE_CONFLICT: '该微信或手机号已绑定其他账号',
  PASSWORD_NOT_SET: PASSWORD_NOT_SET_MESSAGE,
}

export type WechatPhoneDetail = {
  code?: string
  errMsg?: string
} | null | undefined

export type WechatPhoneLoginPlan
  = | { action: 'stop', message?: string }
    | { action: 'need-login-code' }
    | { action: 'submit', request: { loginCode: string, phoneCode: string } }

export function shouldExposeWechatQuickLogin(platform: string) {
  return platform === 'mp-weixin'
}

export function describeAuthFailure(errorCode?: string | null) {
  if (!errorCode) {
    return ''
  }
  return AUTH_FAILURE_COPY[errorCode] || ''
}

/**
 * 首次与再次登录都进入系统首页（或登录前记录的业务页）。
 * 不要求公司、行业、渠道、部门。无部门也不视为登录失败。
 */
export function postLoginRoute(input: { isFirstLogin?: boolean }) {
  return {
    route: 'home' as const,
    isFirstLogin: Boolean(input.isFirstLogin),
    forceCompany: false,
    forceIndustry: false,
    forceChannel: false,
    forceDepartment: false,
  }
}

export function wechatLoginRequiresDepartment() {
  return false
}

export function sessionStoresWechatCodes(session: object) {
  return EPHEMERAL_WECHAT_CODE_FIELDS.some(field => field in session)
}

export function planWechatPhoneLogin(input: {
  platform: string
  submitting: boolean
  agreementChecked: boolean
  phoneDetail?: WechatPhoneDetail
  loginCode?: string | null
}): WechatPhoneLoginPlan {
  if (input.submitting) {
    return { action: 'stop' }
  }

  if (!shouldExposeWechatQuickLogin(input.platform)) {
    return { action: 'stop', message: WECHAT_UNSUPPORTED_MESSAGE }
  }

  if (!input.agreementChecked) {
    return { action: 'stop', message: AGREEMENT_REQUIRED_MESSAGE }
  }

  const phoneCode = readPhoneCode(input.phoneDetail)
  if (!phoneCode) {
    return { action: 'stop', message: WECHAT_PHONE_AUTH_DENIED_MESSAGE }
  }

  if (input.loginCode === undefined) {
    return { action: 'need-login-code' }
  }

  const loginCode = input.loginCode.trim()
  if (!loginCode) {
    return { action: 'stop', message: WECHAT_LOGIN_FAILED_MESSAGE }
  }

  return {
    action: 'submit',
    request: { loginCode, phoneCode },
  }
}

function readPhoneCode(detail: WechatPhoneDetail) {
  const errMsg = detail?.errMsg?.trim() || ''
  const denied = /deny|cancel/i.test(errMsg) || (/fail/i.test(errMsg) && !/ok/i.test(errMsg))
  const code = detail?.code?.trim() || ''
  if (denied || !code) {
    return ''
  }
  return code
}
