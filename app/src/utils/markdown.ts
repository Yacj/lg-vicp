import MarkdownIt from 'markdown-it'

let instance: InstanceType<typeof MarkdownIt> | null = null

function getMarkdownIt() {
  if (!instance) {
    instance = new MarkdownIt({
      // 关闭原始 HTML 渲染（AI 输出不可信，防注入）
      html: false,
      // 后端输出换行转 <br>，适配聊天场景
      breaks: true,
      linkify: true,
    })
  }
  return instance
}

/** AI 消息 Markdown → HTML（供 mp-html 跨端渲染） */
export function renderMarkdown(content: string) {
  return getMarkdownIt().render(content)
}

/** Markdown 源码 → 纯文本（复制到剪贴板用） */
export function markdownToPlainText(content: string) {
  return content
    .replace(/```[\s\S]*?```/g, block => block.replace(/^```[^\n]*\n?|\n?```$/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
}

/** mp-html extern-style：Markdown 排版样式，全量走 --app-* token 适配深色模式 */
export const markdownStyle = `
  h1,h2,h3,h4,h5,h6 { margin: 20rpx 0 10rpx; color: var(--app-text-primary); font-weight: 700; line-height: 1.5; }
  h1 { font-size: 36rpx; }
  h2 { font-size: 34rpx; }
  h3 { font-size: 32rpx; }
  h4,h5,h6 { font-size: 30rpx; }
  p { margin: 10rpx 0; }
  ul, ol { margin: 10rpx 0; padding-left: 36rpx; }
  li { margin: 6rpx 0; }
  code { padding: 2rpx 10rpx; border-radius: 8rpx; background: var(--app-bg-soft); color: var(--app-action-primary); font-size: 24rpx; }
  pre { margin: 14rpx 0; padding: 20rpx; border-radius: var(--app-radius-md); background: var(--app-bg-soft); overflow-x: auto; }
  pre code { padding: 0; background: transparent; color: var(--app-text-primary); }
  blockquote { margin: 14rpx 0; padding-left: 18rpx; border-left: 6rpx solid var(--app-border-default); color: var(--app-text-tertiary); }
  table { margin: 14rpx 0; width: 100%; border-collapse: collapse; }
  th, td { padding: 10rpx 14rpx; border: 1px solid var(--app-border-default); font-size: 24rpx; line-height: 1.5; }
  th { background: var(--app-bg-soft); font-weight: 700; }
  a { color: var(--app-action-primary); }
  img { max-width: 100%; }
  hr { margin: 20rpx 0; border: none; border-top: 1px solid var(--app-border-default); }
`
