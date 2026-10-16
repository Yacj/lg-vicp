declare module '@/uni_modules/mp-html/components/mp-html/mp-html.vue' {
  import type { DefineComponent } from 'vue'

  const MpHtml: DefineComponent<{
    content?: string
    tagStyle?: Record<string, string>
    containerStyle?: string
    scrollTable?: boolean
    previewImg?: boolean | string
  }>
  export default MpHtml
}
