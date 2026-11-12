const { defineConfig } = require('@playwright/test')
module.exports = defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 60000,
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL, headless: true, trace: 'retain-on-failure' },
})
