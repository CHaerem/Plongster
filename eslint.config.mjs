import js from '@eslint/js';

const browserGlobals = {
    window: 'readonly',
    document: 'readonly',
    localStorage: 'readonly',
    sessionStorage: 'readonly',
    navigator: 'readonly',
    console: 'readonly',
    fetch: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    URL: 'readonly',
    AbortController: 'readonly',
    history: 'readonly',
    location: 'readonly',
    HTMLElement: 'readonly',
    DOMParser: 'readonly',
    DOMException: 'readonly',
    MutationObserver: 'readonly',
    requestAnimationFrame: 'readonly',
    alert: 'readonly',
    confirm: 'readonly',
    TextEncoder: 'readonly',
    crypto: 'readonly',
    Promise: 'readonly',
    Set: 'readonly',
    Map: 'readonly',
};

const nodeGlobals = {
    process: 'readonly',
    require: 'readonly',
    module: 'readonly',
    __dirname: 'readonly',
    __filename: 'readonly',
    Buffer: 'readonly',
    console: 'readonly',
    fetch: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    URL: 'readonly',
    Set: 'readonly',
    Map: 'readonly',
};

export default [
    js.configs.recommended,
    {
        ignores: ['node_modules/**', 'icons/**'],
    },
    // ─── Default rules for all JS files ───
    {
        rules: {
            // Indentation handled by Prettier — disable to avoid conflicts
            indent: 'off',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^e$|^_' }],
            'no-console': 'off',
            'no-constant-condition': 'warn',
            'no-empty': ['error', { allowEmptyCatch: true }],
            'prefer-const': 'warn',
            eqeqeq: ['warn', 'always'],
        },
    },
    // ─── ES module source files (main.js, src/**) ───
    {
        files: ['main.js', 'src/**/*.js', 'songs-data.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: browserGlobals,
        },
    },
    // ─── Service worker ───
    {
        files: ['sw.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                self: 'readonly',
                caches: 'readonly',
                clients: 'readonly',
                skipWaiting: 'readonly',
                Response: 'readonly',
                URL: 'readonly',
                console: 'readonly',
                fetch: 'readonly',
            },
        },
    },
    // ─── test.js: Node.js test runner ───
    {
        files: ['test.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: nodeGlobals,
        },
    },
    // ─── Tools: Node.js scripts ───
    {
        files: ['tools/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: nodeGlobals,
        },
    },
];
