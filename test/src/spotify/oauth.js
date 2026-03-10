// Spotify OAuth PKCE flow
// Handles authorization, token exchange, refresh, and logout

import { SPOTIFY_CONFIG, getRedirectUri } from './config.js';

const TOKEN_KEY = 'plongster-spotify-token';
const VERIFIER_KEY = 'plongster-spotify-verifier';

// ─── PKCE Helpers ───

function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(values, v => chars[v % chars.length]).join('');
}

async function sha256(plain) {
    const data = new TextEncoder().encode(plain);
    return crypto.subtle.digest('SHA-256', data);
}

function base64urlEncode(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = '';
    for (const b of bytes) str += String.fromCharCode(b);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── Token Storage ───

function getStoredToken() {
    try {
        const data = localStorage.getItem(TOKEN_KEY);
        if (!data) return null;
        return JSON.parse(data);
    } catch {
        return null;
    }
}

function storeToken(tokenData) {
    const record = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: Date.now() + tokenData.expires_in * 1000,
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(record));
    return record;
}

function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(VERIFIER_KEY);
}

// ─── Public API ───

export function isLoggedIn() {
    const token = getStoredToken();
    return token !== null && !!token.access_token;
}

export function getUsername() {
    try {
        const data = localStorage.getItem('plongster-spotify-user');
        if (!data) return null;
        return JSON.parse(data).name || null;
    } catch {
        return null;
    }
}

/**
 * Get a valid access token, refreshing if expired.
 * Returns null if not logged in or refresh fails.
 */
export async function getAccessToken() {
    const token = getStoredToken();
    if (!token) return null;

    // Token still valid (with 60s buffer)
    if (token.expires_at > Date.now() + 60000) {
        return token.access_token;
    }

    // Try refresh
    if (token.refresh_token) {
        try {
            return await refreshToken(token.refresh_token);
        } catch {
            clearToken();
            return null;
        }
    }

    clearToken();
    return null;
}

/**
 * Start the OAuth PKCE authorization flow.
 * Redirects the browser to Spotify's auth page.
 */
export async function startLogin() {
    if (!SPOTIFY_CONFIG.clientId) {
        console.error('Spotify client ID not configured');
        return;
    }

    const verifier = generateRandomString(64);
    localStorage.setItem(VERIFIER_KEY, verifier);

    const challenge = base64urlEncode(await sha256(verifier));

    const params = new URLSearchParams({
        client_id: SPOTIFY_CONFIG.clientId,
        response_type: 'code',
        redirect_uri: getRedirectUri(),
        scope: SPOTIFY_CONFIG.scopes,
        code_challenge_method: 'S256',
        code_challenge: challenge,
    });

    window.location.href = `${SPOTIFY_CONFIG.authUrl}?${params.toString()}`;
}

/**
 * Handle the OAuth callback after redirect from Spotify.
 * Exchanges the authorization code for tokens.
 * Returns true if successfully handled, false otherwise.
 */
export async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');

    if (error) {
        console.warn('Spotify auth error:', error);
        cleanUrl();
        return false;
    }

    if (!code) return false;

    const verifier = localStorage.getItem(VERIFIER_KEY);
    if (!verifier) {
        console.warn('No PKCE verifier found');
        cleanUrl();
        return false;
    }

    try {
        const response = await fetch(SPOTIFY_CONFIG.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: SPOTIFY_CONFIG.clientId,
                grant_type: 'authorization_code',
                code,
                redirect_uri: getRedirectUri(),
                code_verifier: verifier,
            }),
        });

        if (!response.ok) {
            throw new Error(`Token exchange failed: ${response.status}`);
        }

        const tokenData = await response.json();
        storeToken(tokenData);
        localStorage.removeItem(VERIFIER_KEY);

        // Fetch user profile for display
        await fetchAndStoreUser(tokenData.access_token);

        cleanUrl();
        return true;
    } catch (e) {
        console.error('Token exchange error:', e);
        cleanUrl();
        return false;
    }
}

/**
 * Refresh the access token using the refresh token.
 */
async function refreshToken(refreshTokenValue) {
    const response = await fetch(SPOTIFY_CONFIG.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: SPOTIFY_CONFIG.clientId,
            grant_type: 'refresh_token',
            refresh_token: refreshTokenValue,
        }),
    });

    if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`);
    }

    const tokenData = await response.json();
    // Spotify may or may not return a new refresh token
    if (!tokenData.refresh_token) {
        tokenData.refresh_token = refreshTokenValue;
    }
    const record = storeToken(tokenData);
    return record.access_token;
}

async function fetchAndStoreUser(accessToken) {
    try {
        const response = await fetch(`${SPOTIFY_CONFIG.apiBase}/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (response.ok) {
            const user = await response.json();
            localStorage.setItem('plongster-spotify-user', JSON.stringify({ name: user.display_name, id: user.id }));
        }
    } catch {
        // Non-critical, ignore
    }
}

function cleanUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    url.searchParams.delete('error');
    history.replaceState(null, '', url.pathname + url.hash);
}

export function logout() {
    clearToken();
    localStorage.removeItem('plongster-spotify-user');
}
