import { buildRegisterPasswordBody } from './clientRegister.ts'

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

const valid = buildRegisterPasswordBody({
  phone: '13800138000',
  password: 'abcde',
  confirmPassword: 'abcde',
  agreementChecked: true,
})

assert(valid.ok, '合法表单可提交')
assert(valid.ok && valid.data.clientType === 'C_APP', '固定 C 端 clientType')
assert(valid.ok && valid.data.phone === '13800138000', '提交手机号')
assert(valid.ok && !('role' in valid.data), '不传 role')
assert(valid.ok && !('adminLoginEnabled' in valid.data), '不传 adminLoginEnabled')
assert(valid.ok && !('nickname' in valid.data) && !('displayName' in valid.data), '当前接口不传昵称')
assert(valid.ok && !('code' in valid.data), '当前接口不传验证码')
assert(valid.ok && !('company' in valid.data) && !('channelType' in valid.data), '不传公司/渠道字段')

assert(!buildRegisterPasswordBody({
  phone: '13800138000',
  password: 'abcde',
  confirmPassword: 'abcde',
  agreementChecked: false,
}).ok, '未勾选协议不可提交')

assert(!buildRegisterPasswordBody({
  phone: '13800138000',
  password: 'abcde',
  confirmPassword: 'abcdx',
  agreementChecked: true,
}).ok, '确认密码必须一致')

assert(!buildRegisterPasswordBody({
  phone: '1380013800',
  password: 'abcde',
  confirmPassword: 'abcde',
  agreementChecked: true,
}).ok, '手机号格式校验')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  throw new Error(`clientRegister tests failed: ${failed}`)
}
