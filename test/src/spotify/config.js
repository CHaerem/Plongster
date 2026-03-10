// Spotify OAuth PKCE configuration
// Register your app at https://developer.spotify.com/dashboard
// Add redirect URI: https://chaerem.github.io/Hitster/ (and http://localhost:8080/ for dev)

export const SPOTIFY_CONFIG = {
    clientId: null, // Set via setClientId() or environment
    scopes: 'playlist-read-private playlist-read-collaborative',
    authUrl: 'https://accounts.spotify.com/authorize',
    tokenUrl: 'https://accounts.spotify.com/api/token',
    apiBase: 'https://api.spotify.com/v1',
};

// Redirect URI is derived from current origin for portability
export function getRedirectUri() {
    const origin = window.location.origin;
    const path = window.location.pathname.replace(/\/[^/]*$/, '/');
    return origin + path;
}

export function setClientId(id) {
    SPOTIFY_CONFIG.clientId = id;
}
