// Hitster Service Worker
// Caches app shell for offline/installable PWA experience

const CACHE_VERSION = 'hitster-v35';

// App shell — files needed for the app to work
const APP_SHELL = [
    '/',
    '/index.html',
    '/style.css',
    '/main.js',
    '/songs-data.js',
    '/src/utils.js',
    '/src/songs.js',
    '/src/app.js',
    '/src/game/engine.js',
    '/src/game/ui.js',
    '/src/game/spotify.js',
    '/src/game/state.js',
    '/src/game/gm-panel.js',
    '/src/game/phases.js',
    '/src/spotify/auth.js',
    '/src/spotify/playlist.js',
    '/src/spotify/cors-proxy.js',
    '/src/spotify/config.js',
    '/src/spotify/oauth.js',
    '/src/spotify/api.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-192-maskable.png',
    '/icons/icon-512.png',
    '/icons/icon-512-maskable.png',
    '/icons/apple-touch-icon.png',
];

// External resources to cache (fonts)
const EXTERNAL_CACHE = ['https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap'];

// Never cache these (Spotify embed, APIs, CORS proxies)
const NEVER_CACHE_PATTERNS = [
    /open\.spotify\.com/,
    /api\.spotify\.com/,
    /accounts\.spotify\.com/,
    /api\.codetabs\.com/,
    /api\.allorigins\.win/,
    /sdk\.scdn\.co/,
    /scdn\.co/,
];

// --- Install: pre-cache app shell ---
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then(async cache => {
            // Cache local files
            await cache.addAll(APP_SHELL);

            // Try to cache external resources (non-critical)
            for (const url of EXTERNAL_CACHE) {
                try {
                    await cache.add(url);
                } catch (e) {
                    console.warn('SW: Could not cache external:', url);
                }
            }
        }),
    );
    // Activate immediately, don't wait for old tabs to close
    self.skipWaiting();
});

// --- Activate: clean up old caches ---
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key)));
        }),
    );
    // Take control of all open tabs immediately
    self.clients.claim();
});

// --- Fetch: stale-while-revalidate for app shell, network-only for Spotify ---
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Never cache Spotify and API requests — they must be live
    if (NEVER_CACHE_PATTERNS.some(pattern => pattern.test(event.request.url))) {
        return; // Let the browser handle it normally
    }

    // For navigation requests (HTML pages): network-first with cache fallback
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Update cache with fresh version
                    const clone = response.clone();
                    caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => {
                    // Offline: serve from cache
                    return caches.match(event.request) || caches.match('/index.html');
                }),
        );
        return;
    }

    // For app shell files: stale-while-revalidate
    // Serve from cache immediately, then update cache in background
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                const fetchPromise = fetch(event.request)
                    .then(response => {
                        // Only cache valid responses
                        if (response.ok) {
                            const clone = response.clone();
                            caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
                        }
                        return response;
                    })
                    .catch(() => cached); // If network fails, fall back to cache

                // Return cached version immediately, or wait for network
                return cached || fetchPromise;
            }),
        );
        return;
    }

    // For Google Fonts and other cross-origin: cache-first
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;

            return fetch(event.request).then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
                }
                return response;
            });
        }),
    );
});
