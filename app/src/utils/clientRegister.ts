import type { PasswordRegisterBody } from '@/api/types'

const PHONE_PATTERN = /^1[3-9]\d{9}$/

export interface ClientRegisterForm {
  phone: string
  password: string
  confirmPassword: string
  agreementChecked: boolean
}

export function buildRegisterPasswordBody(form: ClientRegisterForm): { ok: true, data: PasswordRegisterBody } | { ok: false, error: string } {
  const phone = form.phone.trim()
  if (!PHONE_PATTERN.test(phone)) {
    return { ok: false, error: '请输入正确的手机号' }
  }
  if (form.password.length < 5) {
    return { ok: false, error: '密码至少需要 5 位' }
  }
  if (form.password !== form.confirmPassword) {
    return { ok: false, error: '两次输入的密码不一致' }
  }
  if (!form.agreementChecked) {
    return { ok: false, error: '请先阅读并同意用户协议和隐私政策' }
  }

  return {
    ok: true,
    data: {
      clientType: 'C_APP',
      phone,
      password: form.password,
    },
  }
}
