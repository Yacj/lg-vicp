import {
  AGREEMENT_REQUIRED_MESSAGE,
  EPHEMERAL_WECHAT_CODE_FIELDS,
  PASSWORD_NOT_SET_MESSAGE,
  WECHAT_LOGIN_FAILED_MESSAGE,
  WECHAT_PHONE_AUTH_DENIED_MESSAGE,
  WECHAT_UNSUPPORTED_MESSAGE,
  describeAuthFailure,
  planWechatPhoneLogin,
  postLoginRoute,
  sessionStoresWechatCodes,
  shouldExposeWechatQuickLogin,
  wechatLoginRequiresDepartment,
} from './wechatPhoneLogin.ts'

let failed = 0
let passed = 0

function assert(condition: unknown, name: string) {
  if (condition) {
    passed += 1
    console.log(`ok  ${name}`)
    return
  }
  failed += 1
  console.error(`FAIL  ${name}`)
}

const phoneOk = { code: 'phone-code-1', errMsg: 'getPhoneNumber:ok' }

function submitPlan(extra: Partial<Parameters<typeof planWechatPhoneLogin>[0]> = {}) {
  return planWechatPhoneLogin({
    platform: 'mp-weixin',
    submitting: false,
    agreementChecked: true,
    phoneDetail: phoneOk,
    loginCode: 'login-code-1',
    ...extra,
  })
}

assert(shouldExposeWechatQuickLogin('mp-weixin'), '小程序展示微信快速登录')
assert(!shouldExposeWechatQuickLogin('h5'), 'H5 不展示微信快速登录')
assert(!shouldExposeWechatQuickLogin('app'), 'App 不调用小程序登录')

const first = postLoginRoute({ isFirstLogin: true })
assert(first.route === 'home' && first.isFirstLogin, '首次微信登录进入首页')
assert(!first.forceCompany && !first.forceIndustry && !first.forceChannel && !first.forceDepartment, '首次登录不强制公司行业渠道部门')

const again = postLoginRoute({ isFirstLogin: false })
assert(again.route === 'home' && !again.isFirstLogin, '再次微信登录进入首页')

const merged = submitPlan()
assert(merged.action === 'submit' && merged.request.loginCode === 'login-code-1' && merged.request.phoneCode === 'phone-code-1', '手机号已有账号仍提交两个 code')
assert(merged.action === 'submit' && !('phone' in merged.request), '不提交明文手机号')
assert(merged.action === 'submit' && Object.keys(merged.request).join(',') === 'loginCode,phoneCode', '请求体只有 loginCode 与 phoneCode')

const denied = planWechatPhoneLogin({
  platform: 'mp-weixin',
  submitting: false,
  agreementChecked: true,
  phoneDetail: { errMsg: 'getPhoneNumber:fail user deny' },
  loginCode: 'login-code-1',
})
assert(denied.action === 'stop' && denied.message === WECHAT_PHONE_AUTH_DENIED_MESSAGE, '拒绝手机号授权使用自然提示')

const loginFailed = submitPlan({ loginCode: '' })
assert(loginFailed.action === 'stop' && loginFailed.message === WECHAT_LOGIN_FAILED_MESSAGE, 'wx.login 失败不报技术错误')

const needFreshCode = planWechatPhoneLogin({
  platform: 'mp-weixin',
  submitting: false,
  agreementChecked: true,
  phoneDetail: phoneOk,
})
assert(needFreshCode.action === 'need-login-code', '未拿到 loginCode 前不提交旧 code')

assert(describeAuthFailure('WECHAT_LOGIN_CODE_INVALID').includes('重新授权'), '微信 code 失效提示重新授权')
assert(describeAuthFailure('USER_DISABLED') === '账号已被禁用', '用户被禁用使用账号文案')
assert(describeAuthFailure('PASSWORD_NOT_SET') === PASSWORD_NOT_SET_MESSAGE, '密码未设置文案')

const noAgreement = submitPlan({ agreementChecked: false })
assert(noAgreement.action === 'stop' && noAgreement.message === AGREEMENT_REQUIRED_MESSAGE, '未确认协议不发起登录')
assert(noAgreement.action === 'stop' && !('request' in noAgreement), '未确认协议不保留 phoneCode')

const duplicate = submitPlan({ submitting: true })
assert(duplicate.action === 'stop' && !duplicate.message, '登录中禁止重复提交')

const h5 = submitPlan({ platform: 'h5' })
assert(h5.action === 'stop' && h5.message === WECHAT_UNSUPPORTED_MESSAGE, '非微信环境不调用登录')

assert(!wechatLoginRequiresDepartment(), '无部门不视为登录失败')
assert(postLoginRoute({ isFirstLogin: true }).forceDepartment === false, '首次微信用户无部门仍可登录')

const session = {
  accessToken: 'token',
  refreshToken: 'refresh',
  user: { id: 'u1' },
  passwordSet: false,
  isFirstLogin: true,
}
assert(!sessionStoresWechatCodes(session), '会话不保存临时 code')
assert(EPHEMERAL_WECHAT_CODE_FIELDS.includes('loginCode') && EPHEMERAL_WECHAT_CODE_FIELDS.includes('phoneCode'), 'code 字段标记为临时')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  throw new Error(`wechatPhoneLogin tests failed: ${failed}`)
}
