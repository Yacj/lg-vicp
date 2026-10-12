import uni from '@uni-helper/eslint-config'

export default uni(
  {
    unocss: true,
    rules: {
      'no-console': 'off',
      'eslint-comments/no-unlimited-disable': 'off',
    },
    ignores: [
      'src/uni_modules/**/*',
      'docs/.vitepress/dist',
      'docs/.vitepress/cache',
      '**/*.md',
    ],
  },
  {
    name: 'app/node-tests',
    files: ['src/**/*.test.ts'],
    rules: {
      // 本项目使用 node:test；避免默认 Vitest 规则自动改写导入与测试调用。
      'test/no-import-node-test': 'off',
      'test/consistent-test-it': 'off',
      'test/prefer-lowercase-title': 'off',
    },
  },
)
