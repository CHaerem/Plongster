// Spotify anonymous token acquisition
// Extracts access token from embed page __NEXT_DATA__

import { fetchViaCorsProxy } from './cors-proxy.js';

let anonToken = null;
let anonTokenExpiry = 0;

function findToken(data) {
    try {
        const paths = [
            data?.props?.pageProps?.state?.session?.accessToken,
            data?.props?.pageProps?.state?.settings?.session?.accessToken,
            data?.props?.pageProps?.accessToken,
        ];
        for (const t of paths) {
            if (t && typeof t === 'string' && t.length > 20) return t;
        }
    } catch (e) {}

    // Fallback: regex on stringified data (only runs if known paths fail)
    try {
        const json = JSON.stringify(data);
        const tokenMatch = json.match(/"accessToken"\s*:\s*"(BQ[A-Za-z0-9_-]{50,})"/);
        if (tokenMatch) return tokenMatch[1];
    } catch (e) {}

    return null;
}

export async function getAnonymousToken(signal) {
    if (anonToken && anonTokenExpiry > Date.now()) {
        return anonToken;
    }

    const embedUrl = 'https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT';

    try {
        const html = await fetchViaCorsProxy(embedUrl, signal, 12000);

        const match = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (!match) return null;

        let nextData;
        try {
            nextData = JSON.parse(match[1]);
        } catch (e) {
            return null;
        }

        const token = findToken(nextData);
        if (!token) return null;

        anonToken = token;
        anonTokenExpiry = Date.now() + 50 * 60 * 1000;
        return token;
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        console.warn('Token extraction failed:', e.message);
        return null;
    }
}
