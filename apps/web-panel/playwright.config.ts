import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',workers:1,timeout:30000,
  use:{headless:true},
  projects:[
    {name:'public',testIgnore:['styles-authenticated.spec.ts','video-queue-authenticated.spec.ts'],use:{baseURL:'http://localhost:3100'}},
    {name:'styles',testMatch:['styles-authenticated.spec.ts','video-queue-authenticated.spec.ts'],use:{baseURL:'http://localhost:3101'}},
  ],
  webServer:[
    {command:'node ../../node_modules/next/dist/bin/next start --port 3100 --hostname 127.0.0.1',url:'http://localhost:3100/api/health',reuseExistingServer:!process.env.CI,env:{APP_URL:'http://localhost:3100'},timeout:60000},
    {command:'node --import ./tests/fixtures/style-backend.mjs ../../node_modules/next/dist/bin/next start --port 3101 --hostname 127.0.0.1',url:'http://localhost:3101/api/health',reuseExistingServer:false,env:{STORY_STYLE_TEST_FIXTURE:'1',NEXT_TELEMETRY_DISABLED:'1'},timeout:60000},
  ],
  reporter:'list',
});
