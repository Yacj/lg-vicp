import type { Plugin } from 'vite'

/**
 * 微信小程序环境缺少 Node/Browser 的全局能力（atob/btoa/Buffer）。
 * markdown-it 依赖的 entities 库在模块顶层执行 decodeBase64() 生成 HTML 实体解码表，
 * 该函数在无 atob 时回退到 Buffer.from，导致小程序启动即抛
 * "Can't find variable: Buffer"（H5 有浏览器原生 atob，故无此问题）。
 * 由于 vendor.js 先于业务代码被 require，polyfill 必须注入到 vendor.js 文件头部。
 */
const NODE_ENV_POLYFILL = `
;(function (root) {
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  if (typeof root.atob !== 'function') {
    root.atob = function (input) {
      var str = String(input).replace(/[^A-Za-z0-9+/=]/g, '').replace(/=+$/, '')
      var output = ''
      var buffer = 0
      var bits = 0
      for (var i = 0; i < str.length; i++) {
        buffer = (buffer << 6) | B64.indexOf(str.charAt(i))
        bits += 6
        if (bits >= 8) {
          bits -= 8
          output += String.fromCharCode((buffer >> bits) & 0xff)
        }
      }
      return output
    }
  }
  if (typeof root.btoa !== 'function') {
    root.btoa = function (input) {
      var str = String(input)
      var output = ''
      for (var i = 0; i < str.length; i += 3) {
        var c1 = str.charCodeAt(i) & 0xff
        var c2 = i + 1 < str.length ? str.charCodeAt(i + 1) & 0xff : 0
        var c3 = i + 2 < str.length ? str.charCodeAt(i + 2) & 0xff : 0
        output += B64.charAt(c1 >> 2) + B64.charAt(((c1 & 3) << 4) | (c2 >> 4)) + B64.charAt(((c2 & 15) << 2) | (c3 >> 6)) + B64.charAt(c3 & 63)
      }
      var pad = str.length % 3
      if (pad === 1) output = output.slice(0, -2) + '=='
      else if (pad === 2) output = output.slice(0, -1) + '='
      return output
    }
  }
  if (typeof root.Buffer === 'undefined') {
    function BufferLike(value, encoding) {
      if (encoding === 'base64') {
        return { toString: function () { return root.atob(String(value)) } }
      }
      return { toString: function () { return value == null ? '' : String(value) } }
    }
    BufferLike.from = BufferLike
    root.Buffer = BufferLike
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {}))
`

export function mpNodeEnvPolyfill(): Plugin {
  return {
    name: 'mp-node-env-polyfill',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const vendor = bundle['common/vendor.js']
      if (vendor && 'code' in vendor) {
        vendor.code = `${NODE_ENV_POLYFILL}\n${vendor.code}`
      }
    },
  }
}