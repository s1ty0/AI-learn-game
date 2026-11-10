import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", timeout: 45000, fullyParallel: false, workers: 1,
  use: { baseURL: process.env.LEARN_TEST_BASE_URL??"http://127.0.0.1:3000", viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure" },
  reporter: "list",
});
