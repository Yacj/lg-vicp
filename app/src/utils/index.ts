/**
 * 获取当前页面路径
 * @returns 当前页面路径
 */
export function getCurrentPath() {
  const pages = getCurrentPages()
  const currentPage = pages[pages.length - 1]
  return currentPage.route || ''
}

/**
 * 相对时间格式化：刚刚 / n 分钟前 / n 小时前 / 昨天 / n 天前 / M月D日 / YYYY年M月D日
 * 无效日期返回空字符串，由调用方决定兜底文案。
 */
export function formatRelativeTime(value: string | number | Date) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const diff = Date.now() - date.getTime()

  if (diff < minute) {
    return '刚刚'
  }
  if (diff < hour) {
    return `${Math.floor(diff / minute)} 分钟前`
  }
  if (diff < day) {
    return `${Math.floor(diff / hour)} 小时前`
  }
  if (diff < 2 * day) {
    return '昨天'
  }
  if (diff < 7 * day) {
    return `${Math.floor(diff / day)} 天前`
  }

  const label = `${date.getMonth() + 1}月${date.getDate()}日`
  return date.getFullYear() === new Date().getFullYear() ? label : `${date.getFullYear()}年${label}`
}
