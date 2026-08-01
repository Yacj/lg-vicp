import antfu from '@antfu/eslint-config'

export default antfu(
  {
    ignores: [
      'public',
      'dist*',
      'docs',
    ],
  },
  {
    rules: {
      'eslint-comments/no-unlimited-disable': 'off',
      'curly': ['error', 'all'],
      'no-console': 'off',
    },
  },
  {
    files: [
      'src/**/*.vue',
    ],
    rules: {
      'no-alert': 'error',
      'no-restricted-syntax': [
        'error',
        { selector: 'VElement[name=\'button\']', message: '请使用 TDesign Button。' },
        { selector: 'VElement[name=\'input\']', message: '请使用 TDesign Input。' },
        { selector: 'VElement[name=\'select\']', message: '请使用 TDesign Select。' },
        { selector: 'VElement[name=\'textarea\']', message: '请使用 TDesign Textarea。' },
        { selector: 'VElement[name=\'dialog\']', message: '请使用 TDesign Dialog。' },
        { selector: 'VElement[name=\'form\']', message: '请使用 TDesign Form。' },
        { selector: 'VElement[name=\'table\']', message: '请使用 TDesign Table。' },
      ],
      'vue/block-order': ['error', {
        order: ['route', 'script', 'template', 'style'],
      }],
    },
  },
)
