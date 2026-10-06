export type PasswordFlowMode = 'set' | 'reset'

export interface PasswordSmsPayload {
  clientType: 'C_APP'
  phone: string
  code: string
  password: string
}

export interface PasswordSmsSendPayload {
  clientType: 'C_APP'
  phone: string
  purpose: 'PASSWORD'
}

const PHONE_PATTERN = /^1[3-9]\d{9}$/
const SMS_PATTERN = /^\d{6}$/

export function describePasswordStatus(passwordSet: boolean | null | undefined) {
  if (passwordSet === false) {
    return {
      statusText: '未设置',
      actionText: '设置',
      mode: 'set' as const,
    }
  }

  return {
    statusText: '已设置',
    actionText: '修改',
    mode: 'reset' as const,
  }
}

export function buildSendPasswordSmsBody(phone: string): { ok: true, data: PasswordSmsSendPayload } | { ok: false, error: string } {
  const normalized = phone.trim()
  if (!PHONE_PATTERN.test(normalized)) {
    return { ok: false, error: '请输入正确的手机号' }
  }

  return {
    ok: true,
    data: {
      clientType: 'C_APP',
      phone: normalized,
      purpose: 'PASSWORD',
    },
  }
}

export function buildClientPasswordSmsBody(form: {
  phone: string
  code: string
  password: string
  confirmPassword: string
}): { ok: true, data: PasswordSmsPayload } | { ok: false, error: string } {
  const phone = form.phone.trim()
  const code = form.code.trim()
  if (!PHONE_PATTERN.test(phone)) {
    return { ok: false, error: '请输入正确的手机号' }
  }
  if (!SMS_PATTERN.test(code)) {
    return { ok: false, error: '请输入 6 位短信验证码' }
  }
  if (form.password.length < 5) {
    return { ok: false, error: '密码至少需要 5 位' }
  }
  if (form.password !== form.confirmPassword) {
    return { ok: false, error: '两次输入的密码不一致' }
  }

  return {
    ok: true,
    data: {
      clientType: 'C_APP',
      phone,
      code,
      password: form.password,
    },
  }
}
