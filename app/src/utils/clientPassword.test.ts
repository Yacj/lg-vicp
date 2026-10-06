import {
  buildClientPasswordSmsBody,
  buildSendPasswordSmsBody,
  describePasswordStatus,
} from './clientPassword.ts'

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

const unset = describePasswordStatus(false)
assert(unset.statusText === '未设置' && unset.actionText === '设置' && unset.mode === 'set', 'passwordSet=false 显示设置')

const set = describePasswordStatus(true)
assert(set.statusText === '已设置' && set.actionText === '修改' && set.mode === 'reset', 'passwordSet=true 显示修改')

const sms = buildSendPasswordSmsBody('13800138000')
assert(sms.ok && sms.data.purpose === 'PASSWORD' && sms.data.clientType === 'C_APP', '设置密码复用短信验证码')
assert(!buildSendPasswordSmsBody('123').ok, '短信发送校验手机号')

const password = buildClientPasswordSmsBody({
  phone: '13800138000',
  code: '123456',
  password: 'abcde',
  confirmPassword: 'abcde',
})
assert(password.ok && password.data.password === 'abcde' && !('role' in password.data), '设置密码提交短信与新密码')

const reset = buildClientPasswordSmsBody({
  phone: '13800138000',
  code: '654321',
  password: 'newpass',
  confirmPassword: 'newpass',
})
assert(reset.ok && reset.data.code === '654321', '忘记密码走同一短信表单')
assert(!buildClientPasswordSmsBody({
  phone: '13800138000',
  code: '654321',
  password: 'newpass',
  confirmPassword: 'other',
}).ok, '确认密码必须一致')
assert(!buildClientPasswordSmsBody({
  phone: '13800138000',
  code: '12',
  password: 'newpass',
  confirmPassword: 'newpass',
}).ok, '验证码必须为 6 位')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  throw new Error(`clientPassword tests failed: ${failed}`)
}
