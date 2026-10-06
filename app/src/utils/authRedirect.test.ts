import { TABBAR_ITEMS } from '../constants/navigation.ts'
import {
  applyAuthRedirect,
  buildAuthPageLocation,
  getLoginRedirect,
  isTabBarPath,
  parseRedirectTarget,
  sanitizeRedirect,
} from './authRedirect.ts'

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

assert(sanitizeRedirect('/pages/project-detail/index?id=1') === '/pages/project-detail/index?id=1', '保留内部路径和 query')
assert(sanitizeRedirect('pages/project-detail/index') === '/pages/project-detail/index', '补齐前导斜杠')
assert(sanitizeRedirect('%2Fpages%2Fproject-detail%2Findex%3Fid%3D1') === '/pages/project-detail/index?id=1', '解码一次编码的 redirect')
assert(sanitizeRedirect('/pages/login') === '', '拒绝登录页')
assert(sanitizeRedirect('/pages/register/index?from=1') === '', '拒绝注册页')
assert(sanitizeRedirect('/pages/password/index?mode=set') === '', '拒绝密码页作为回跳')
assert(sanitizeRedirect('https://evil.example/pages/index/index') === '', '拒绝外部地址')
assert(sanitizeRedirect('//evil.example') === '', '拒绝协议相对地址')
assert(sanitizeRedirect('/pages/../secret') === '', '拒绝路径穿越')

assert(parseRedirectTarget('/pages/project-detail/index?id=12&tab=files')?.path === '/pages/project-detail/index', '解析详情路径')
assert(parseRedirectTarget('/pages/project-detail/index?id=12&tab=files')?.query.id === '12', '解析详情 query')
assert(parseRedirectTarget('/pages/login') === null, '登录页不能作为回跳目标')

assert(isTabBarPath('/pages/index/index'), '首页是 tabBar')
assert(isTabBarPath('/pages/projects/index?x=1'), '带 query 的 tabBar 仍识别')
assert(!isTabBarPath('/pages/project-detail/index'), '详情页不是 tabBar')
for (const item of TABBAR_ITEMS) {
  assert(isTabBarPath(`/${item.pagePath}`), `${item.name} 与导航常量保持同步`)
}

assert(buildAuthPageLocation('login', '/pages/project-detail/index?id=1').params?.redirect === '/pages/project-detail/index?id=1', 'named 导航把 redirect 放进 params')
assert(!('params' in buildAuthPageLocation('register')), '没有 redirect 时不带 params')

assert(getLoginRedirect({ query: { redirect: '/pages/project-detail/index' } }) === '/pages/project-detail/index', '优先读 query')
assert(getLoginRedirect({ params: { redirect: '/pages/project-detail/index' } }) === '/pages/project-detail/index', '兼容 params')
assert(getLoginRedirect({ query: { redirect: ['/pages/project-detail/index'] } }) === '/pages/project-detail/index', '兼容数组 query')
assert(getLoginRedirect({ query: { redirect: '/pages/login' } }) === '', 'query 指向登录页时丢弃')

const calls: Array<[string, Record<string, unknown>]> = []
const router = {
  async replace(to: Record<string, unknown>) {
    calls.push(['replace', to])
  },
  async replaceAll(to: Record<string, unknown>) {
    calls.push(['replaceAll', to])
  },
}

await applyAuthRedirect(router, '/pages/project-detail/index?id=9')
assert(calls.at(-1)?.[0] === 'replace', '普通页用 replace 保留页面栈')
assert((calls.at(-1)?.[1] as { path?: string }).path === '/pages/project-detail/index', '普通页回跳路径')
assert((calls.at(-1)?.[1] as { query?: { id?: string } }).query?.id === '9', '普通页带回 query')

await applyAuthRedirect(router, '/pages/index/index?from=login')
assert(calls.at(-1)?.[0] === 'replaceAll', 'tabBar 用 reLaunch')
assert((calls.at(-1)?.[1] as { path?: string }).path === '/pages/index/index', 'tabBar 去掉 query')

await applyAuthRedirect(router, '')
assert(calls.at(-1)?.[0] === 'replaceAll', '无 redirect 回首页')
assert((calls.at(-1)?.[1] as { name?: string }).name === 'home', '默认回 home')

const failingRouter = {
  async replace() {
    throw new Error('replace failed')
  },
  async replaceAll(to: Record<string, unknown>) {
    calls.push(['replaceAll', to])
  },
}

await applyAuthRedirect(failingRouter, '/pages/project-detail/index?id=9')
assert((calls.at(-1)?.[1] as { path?: string }).path === '/pages/project-detail/index', 'replace 失败时回退 replaceAll')

await applyAuthRedirect({
  async replace() {
    throw new Error('replace failed')
  },
  async replaceAll() {
    throw new Error('replaceAll failed')
  },
}, '/pages/project-detail/index?id=9')
assert(true, '最终失败时不向外抛错')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  throw new Error(`authRedirect tests failed: ${failed}`)
}
