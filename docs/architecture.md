# Architecture

## Overview

Plongster is a single-page PWA built with vanilla JavaScript ES modules. No build step, no bundler, no framework — files are served as-is from GitHub Pages.

## Module Graph

```
index.html
  └─ main.js (entry point)
       ├─ src/app.js (App controller)
       │    ├─ src/songs.js ──→ songs-data.js (lazy, dynamic import)
       │    ├─ src/spotify/playlist.js
       │    ├─ src/spotify/config.js
       │    ├─ src/spotify/oauth.js
       │    └─ src/spotify/api.js
       ├─ src/game/engine.js
       │    └─ src/songs.js
       ├─ src/game/ui.js
       │    └─ src/utils.js
       ├─ src/game/spotify.js
       ├─ src/game/state.js
       │    ├─ src/songs.js
       │    └─ src/game/phases.js
       └─ src/game/gm-panel.js
            └─ src/songs.js
```

## Singletons

`App` and `Game` are object singletons exposed on `window` for inline `onclick` handlers in `index.html`.

**Game composition:** `main.js` creates a plain object with state properties, then merges method objects from each game module using `Object.defineProperties` (preserves getters like `currentPlayer`).

```javascript
const Game = { players: [], currentPlayerIndex: 0, ... };
[engineMethods, uiMethods, spotifyMethods, stateMethods, gmMethods].forEach(methods => {
    Object.defineProperties(Game, Object.getOwnPropertyDescriptors(methods));
});
```

## Screens

Five screens managed by toggling `.active` class on `.screen` divs:

1. **Welcome** (`#screen-welcome`) — Start or quick-start
2. **Setup** (`#screen-setup`) — Player names, win count, playlist, genre filter
3. **Game** (`#screen-game`) — Active gameplay with overlays
4. **Game Over** (`#screen-gameover`) — Winner display, play again
5. **Credits** (`#screen-credits`)

## Game Phase State Machine

The game uses an explicit phase enum instead of boolean flags:

```
IDLE → PASS_PHONE → LISTENING → PLACING → PLACEMENT_CONFIRM →
PRE_REVEAL → CHALLENGER_PASS → CHALLENGER_PLACING →
CHALLENGER_CONFIRM → REVEAL → TITLE_CLAIM → GAME_OVER
```

Transitions are validated via `isValidTransition(from, to)` in `src/game/phases.js`.

## State Persistence

Game state is saved to `localStorage` key `plongster-game` after every meaningful action. The format is versioned (`stateVersion: 2`) with a migration chain in `src/game/state.js`.

On restore, the state is validated, migrated if needed, and the song deck is reconstructed from the full database minus used songs.

## Spotify Integration

Two components:

1. **Playback** — Spotify Embed IFrame API with retry logic (5 attempts, exponential backoff). No auth needed.
2. **Playlist import** — OAuth PKCE login, Spotify Web API for fetching playlist tracks. Optional — core game works with built-in songs.

All Spotify data access uses official authenticated APIs only (no scraping, no CORS proxies).

## Service Worker

Caching strategies:

- **Install:** Pre-cache all app shell files (JS modules, CSS, icons)
- **Navigation:** Network-first with cache fallback (offline support)
- **Same-origin:** Stale-while-revalidate (fast loads, background updates)
- **Cross-origin:** Cache-first for fonts
- **Never cache:** Spotify APIs, embed SDK
