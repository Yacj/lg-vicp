/**
 * 用户导入 CSV 工具：模板与表头完全对齐后端 /platform/users/import 的契约
 * （见 backend/src/modules/users/users.routes.ts 的 importBodySchema）。
 * 后端按行 split(",") 简单解析，因此模板示例值不包含逗号。
 */
export const USER_IMPORT_HEADERS = [
  'identifier',
  'password',
  'displayName',
  'role',
  'email',
  'channelType',
  'gender',
  'remark',
] as const

const USER_IMPORT_REQUIRED_HEADERS = ['identifier', 'password', 'displayName', 'role'] as const

export const USER_IMPORT_TIPS = [
  '表头必须包含 identifier、password、displayName、role 四个字段',
  'identifier 为登录用户名或手机号（手机号格式自动识别为手机号账号）',
  'role 取值：SUPER_ADMIN / CHANNEL_USER / NORMAL_USER',
  'role 为 CHANNEL_USER 时必须填写 channelType（DEALER 经销商 / SALESPERSON 业务员）',
  'password 长度 12-128 位',
].join('；')

/** 生成导入模板 CSV 文本（不含 BOM，下载时由调用方添加）。 */
export function buildUserImportTemplate(): string {
  const exampleRows = [
    'zhangsan,Vicp@12345678,张三,CHANNEL_USER,zhangsan@example.com,DEALER,MALE,华东大区渠道专员',
    '13800138000,Vicp@12345678,李四,NORMAL_USER,,,FEMALE,',
  ]
  return [USER_IMPORT_HEADERS.join(','), ...exampleRows].join('\n')
}

/** 生成导出文件名，例如 users-20260802-153000.csv。 */
export function buildUserExportFilename(date: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
  return `users-${stamp}.csv`
}

/** 触发浏览器下载文本文件（UTF-8 带 BOM，便于 Excel 识别中文）。 */
export function triggerTextDownload(content: string, filename: string, mimeType = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([`\uFEFF${content}`], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/** 触发浏览器下载二进制文件（用于后端导出的 CSV Blob）。 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function isUserImportHeaderComplete(headers: readonly string[]): boolean {
  return USER_IMPORT_REQUIRED_HEADERS.every(header => headers.includes(header))
}