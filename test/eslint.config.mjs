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
            'indent': 'off',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^e$|^_' }],
            'no-console': 'off',
            'no-constant-condition': 'warn',
            'no-empty': ['error', { allowEmptyCatch: true }],
            'prefer-const': 'warn',
            'eqeqeq': ['warn', 'always'],
        },
    },
    // ─── songs.js: defines SONGS_DATABASE and shuffleArray ───
    {
        files: ['songs.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: browserGlobals,
        },
        rules: {
            'no-unused-vars': 'off',
        },
    },
    // ─── game.js: defines Game, uses globals from songs.js ───
    {
        files: ['game.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...browserGlobals,
                SONGS_DATABASE: 'readonly',
                shuffleArray: 'readonly',
                App: 'readonly',
            },
        },
    },
    // ─── app.js: defines App, uses globals from songs.js and game.js ───
    {
        files: ['app.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...browserGlobals,
                SONGS_DATABASE: 'writable',
                shuffleArray: 'readonly',
                Game: 'readonly',
            },
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
