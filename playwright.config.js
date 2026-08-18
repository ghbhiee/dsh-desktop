'use strict';

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: './e2e',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
};
