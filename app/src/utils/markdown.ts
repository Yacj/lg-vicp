import MarkdownIt from 'markdown-it'

let instance: InstanceType<typeof MarkdownIt> | null = null

/** 代码块内的 code，需覆盖行内 code 的 tag-style */
const FENCE_CODE_STYLE = 'padding:0;background:transparent;color:var(--app-text-primary)'

function decorateMarkdownIt(md: MarkdownIt) {
  // mp-html 用 border / cellspacing 把单元格边框写进内联样式，H5 / App / 小程序都能显示
  md.renderer.rules.table_open = () =>
    '<table border="1" cellspacing="0" style="border-color:var(--app-border-default);border-style:solid;">\n'

  const originFence = md.renderer.rules.fence
  if (originFence) {
    md.renderer.rules.fence = (tokens, idx, options, env, slf) => {
      return originFence(tokens, idx, options, env, slf)
        .replace('<pre>', '<pre style="overflow:auto;">')
        .replace(/<code\b/, `<code style="${FENCE_CODE_STYLE}"`)
    }
  }

  const originCodeBlock = md.renderer.rules.code_block
  if (originCodeBlock) {
    md.renderer.rules.code_block = (tokens, idx, options, env, slf) => {
      return originCodeBlock(tokens, idx, options, env, slf)
        .replace('<pre>', '<pre style="overflow:auto;">')
        .replace(/<code\b/, `<code style="${FENCE_CODE_STYLE}"`)
    }
  }
}

function getMarkdownIt() {
  if (!instance) {
    instance = new MarkdownIt({
      // 关闭原始 HTML 渲染（AI 输出不可信，防注入）
      html: false,
      // 后端输出换行转 <br>，适配聊天场景
      breaks: true,
      linkify: true,
    })
    decorateMarkdownIt(instance)
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

/**
 * mp-html tag-style：按标签写入内联样式。
 * 不用 extern-style（当前 mp-html 未启用 style 插件，三端都不生效）。
 * 尺寸用 em，相对 container-style 的 28rpx，避免 JS 字符串里的 rpx 在 H5 失效。
 */
export const markdownTagStyle: Record<string, string> = {
  h1: 'margin:0.7em 0 0.35em;color:var(--app-text-primary);font-weight:700;line-height:1.5;font-size:1.29em',
  h2: 'margin:0.7em 0 0.35em;color:var(--app-text-primary);font-weight:700;line-height:1.5;font-size:1.21em',
  h3: 'margin:0.7em 0 0.35em;color:var(--app-text-primary);font-weight:700;line-height:1.5;font-size:1.14em',
  h4: 'margin:0.7em 0 0.35em;color:var(--app-text-primary);font-weight:700;line-height:1.5;font-size:1.07em',
  h5: 'margin:0.7em 0 0.35em;color:var(--app-text-primary);font-weight:700;line-height:1.5;font-size:1.07em',
  h6: 'margin:0.7em 0 0.35em;color:var(--app-text-primary);font-weight:700;line-height:1.5;font-size:1.07em',
  p: 'margin:0.35em 0',
  ul: 'margin:0.35em 0;padding-left:1.3em',
  ol: 'margin:0.35em 0;padding-left:1.3em',
  li: 'margin:0.2em 0',
  code: 'padding:0.08em 0.36em;border-radius:var(--app-radius-xs);background:var(--app-bg-soft);color:var(--app-action-primary);font-size:0.86em',
  pre: 'margin:0.5em 0;padding:0.7em;border-radius:var(--app-radius-md);background:var(--app-bg-soft);overflow:auto;white-space:pre',
  blockquote: 'margin:0.5em 0;padding:0.45em 0.75em;border-left:3px solid var(--app-action-primary);background:var(--app-bg-soft);color:var(--app-text-tertiary);border-radius:0 var(--app-radius-xs) var(--app-radius-xs) 0',
  table: 'margin:0.5em 0;width:100%;border-collapse:collapse',
  th: 'padding:0.35em 0.5em;border:1px solid var(--app-border-default);font-size:0.86em;line-height:1.5;background:var(--app-bg-soft);font-weight:700;color:var(--app-text-primary);word-break:break-word',
  td: 'padding:0.35em 0.5em;border:1px solid var(--app-border-default);font-size:0.86em;line-height:1.5;color:var(--app-text-secondary);word-break:break-word',
  a: 'color:var(--app-action-primary)',
  img: 'max-width:100%;height:auto;display:block;margin:0.5em 0;border-radius:var(--app-radius-sm)',
  hr: 'margin:0.7em 0;border:none;border-top:1px solid var(--app-border-default)',
}
