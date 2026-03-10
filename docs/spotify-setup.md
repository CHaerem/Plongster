# Spotify Setup

Hitster uses Spotify for song playback and optional playlist import. The core game works without any Spotify login — playback uses the Spotify Embed IFrame API, and 1200+ built-in songs are included.

## No Login Required

Without any configuration, the app can:

- Play songs via the Spotify Embed IFrame API (no auth needed)
- Use the built-in song database (1200+ songs across 7 decades)

## OAuth PKCE Setup (Optional)

To enable "Log in with Spotify" for importing custom playlists:

### 1. Create a Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click "Create App"
3. Set the redirect URI to your deployment URL (e.g., `https://chaerem.github.io/Hitster/`)
4. For local development, also add `http://localhost:8080/`
5. Note the **Client ID**

### 2. Configure the Client ID

Add a meta tag to `index.html`:

```html
<meta name="spotify-client-id" content="YOUR_CLIENT_ID_HERE" />
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

**Note:** Spotify Development Mode limits apps to 5 authorized users. For wider use, apply for Extended Quota via the Spotify Developer Dashboard.

## Generating the Song Database

The built-in song database is generated offline using Spotify API credentials:

```bash
# Setup
cp tools/.env.example tools/.env
# Edit tools/.env with your Spotify client ID and secret
# Get credentials at https://developer.spotify.com/dashboard

# Generate from a playlist
node tools/generate-songs.js <playlist-url>

# Options
node tools/generate-songs.js --append <playlist-url>   # Add to existing database
node tools/generate-songs.js --validate                 # Check for stale tracks
node tools/generate-songs.js --dry-run <playlist-url>   # Preview without writing
```

API credentials are required for the generator tool. See `tools/.env.example`.
