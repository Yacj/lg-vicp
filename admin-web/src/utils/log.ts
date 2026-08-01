/**
 * @fileoverview
 * 简单的日志工具，支持警告、错误、信息、调试日志，
 * 并提供防止重复日志输出的功能。使用 `dayjs` 进行时间格式化。
 */

import dayjs from 'dayjs'
import { isDev } from '@/utils/env'

const logSet = new Set<string>() // 存储已记录的日志，防止重复
const TITLE = import.meta.env.VITE_APP_TITLE || 'Title' // 应用标题
const PREFIX = isDev() ? `[DEV][${TITLE}]` : `[PROD][${TITLE}]` // 日志前缀

/**
 * 格式化日志信息
 * @param level 日志级别（warn、error、info、debug）
 * @param message 日志内容
 * @returns 格式化后的日志信息
 */
function formatMessage(level: string, message: string): string {
  const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss') // 格式化时间
  return `[${timestamp}] ${PREFIX} ${level.toUpperCase()}: ${message}`
}

const log = {
  /**
   * 输出警告日志
   * @param message 日志内容
   */
  warn(message: string): void {
    console.warn(formatMessage('warn', message))
  },

  /**
   * 仅输出一次警告日志（去重）
   * @param message 日志内容
   */
  warnOnce(message: string): void {
    const logKey = `warn:${message}`
    const msgContent = formatMessage('warn', message)
    if (logSet.has(logKey)) {
      return
    }
    logSet.add(logKey)
    console.warn(msgContent)
  },

  /**
   * 输出错误日志
   * @param message 日志内容
   */
  error(message: string): void {
    console.error(formatMessage('error', message))
  },

  /**
   * 仅输出一次错误日志（去重）
   * @param message 日志内容
   */
  errorOnce(message: string): void {
    const logKey = `error:${message}`
    const msgContent = formatMessage('error', message)
    if (logSet.has(logKey)) {
      return
    }
    logSet.add(logKey)
    console.error(msgContent)
  },

  /**
   * 输出普通信息日志
   * @param message 日志内容
   */
  info(message: string): void {
    console.info(formatMessage('info', message))
  },

  /**
   * 输出调试日志
   * @param message 日志内容
   */
  debug(message: string): void {
    console.debug(formatMessage('debug', message))
  },
  /**
   * 以表格形式输出数据（适用于数组或对象）
   * @param data 需要表格化展示的数据
   * @param title 日志标题（可选）
   */
  table(data: any, title = '日志数据'): void {
    if (typeof console.table === 'function') {
      console.group(`[${dayjs().format('YYYY-MM-DD HH:mm:ss')}] ${PREFIX} TABLE: ${title}`)
      console.table(data)
      console.groupEnd()
    }
    else {
      console.info(formatMessage('info', `您的环境不支持 console.table，原始数据: `), data)
    }
  },
}

export default log
