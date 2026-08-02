import axios from 'axios'

/**
 * 预签名请求专用 axios 实例：
 * - 预签名 URL 直传 / 下载不经业务拦截器（避免附加认证头破坏签名）
 * - 不设置超时（大文件上传由浏览器网络栈控制）
 */
export const presignedClient = axios.create({ timeout: 0 })