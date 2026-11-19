import {defineBaseConfig} from '@joaommotawork/vitest-config'

export default defineBaseConfig({
  test: {
    include: ['src/**/*.test.mjs'],
    coverage: {include: ['src/**/*.mjs'], exclude: ['src/**/*.test.mjs', 'src/test-helpers.mjs']},
  },
})
