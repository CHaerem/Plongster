import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 30000,
    retries: 1,
    use: {
        baseURL: 'http://localhost:8081',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { browserName: 'chromium' },
        },
    ],
    webServer: {
        command: 'python3 -m http.server 8081',
        port: 8081,
        reuseExistingServer: true,
    },
});
