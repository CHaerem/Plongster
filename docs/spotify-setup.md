# Spotify Setup

Hitster uses Spotify for song playback and playlist import. The app works without Spotify login (using anonymous tokens and embed scraping), but logging in enables browsing your own playlists.

## Anonymous Mode (No Setup Required)

Without any configuration, the app can:
- Play songs via the Spotify Embed IFrame API
- Load public playlists by URL (via anonymous token or embed scraping)

## OAuth PKCE Setup (Optional)

To enable "Log in with Spotify" for browsing private playlists:

### 1. Create a Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click "Create App"
3. Set the redirect URI to your deployment URL (e.g., `https://chaerem.github.io/Hitster/`)
4. For local development, also add `http://localhost:8080/`
5. Note the **Client ID**

### 2. Configure the Client ID

Add a meta tag to `index.html`:

```html
<meta name="spotify-client-id" content="YOUR_CLIENT_ID_HERE">
```

The app reads this at startup via `main.js` and passes it to `src/spotify/config.js`.

### 3. How It Works

The OAuth PKCE flow (in `src/spotify/oauth.js`):

1. User clicks "Koble til Spotify" on the setup screen
2. App generates a PKCE code verifier and challenge
3. User is redirected to Spotify's authorization page
4. Spotify redirects back with an authorization code
5. App exchanges the code for access + refresh tokens
6. Tokens are stored in `localStorage` key `hitster-spotify-token`
7. On subsequent visits, the refresh token is used silently

**Scopes requested:** `playlist-read-private playlist-read-collaborative`

### 4. API Fallback Chain

The playlist loading system tries methods in order:

1. **Authenticated Spotify Web API** — if logged in, full access to private playlists
2. **Anonymous token** — client credentials grant for public playlists
3. **Embed page scraping** — parse Spotify embed HTML for track metadata
4. **CORS proxy** — fallback if direct requests are blocked

## Generating the Song Database

The built-in song database is generated from Spotify playlists:

```bash
# Requires SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in tools/.env
node tools/generate-songs.js <playlist-url>

# Options
node tools/generate-songs.js --append <playlist-url>  # Add to existing database
node tools/generate-songs.js --dry-run <playlist-url>  # Preview without writing
```

See `tools/.env.example` for the required environment variables.
