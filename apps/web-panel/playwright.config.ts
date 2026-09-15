import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',workers:1,timeout:30000,
  use:{baseURL:'http://localhost:3100',headless:true},
  webServer:{command:'node ../../node_modules/next/dist/bin/next start --port 3100 --hostname 127.0.0.1',url:'http://localhost:3100/api/health',reuseExistingServer:!process.env.CI,env:{APP_URL:'http://localhost:3100'},timeout:60000},
  reporter:'list',
});
