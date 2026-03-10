# Plongster - Claude Code Instructions

## Project Overview

Norwegian music quiz PWA — players place songs chronologically on a timeline.
Vanilla JavaScript, no frameworks, no build step. Deployed as static files to GitHub Pages.

Live: https://chaerem.github.io/Plongster/
Test/preview: https://chaerem.github.io/Plongster/test/

## Commands

```bash
# Dev server
python3 -m http.server 8080

# Run tests (must pass before any commit)
node test.js

# Run E2E tests
npx playwright test

# Lint and format
npx eslint . && npx prettier --check .

# Generate songs from Spotify playlist
node tools/generate-songs.js <spotify-playlist-url>
```

## Architecture

Single-page app with 5 screens managed by showing/hiding divs (no router). ES modules, no build step.

**Entry point:**

- `index.html` — All UI screens and overlays
- `main.js` — Entry point: composes `Game` from modules, exposes `App`/`Game` on `window`, initializes app

**App & data modules:**

- `src/app.js` — App controller: screen management, setup, playlist loading, genre filtering
- `src/songs.js` — Songs store (get/set/reset), lazy-loads `songs-data.js` via dynamic `import()`
- `src/utils.js` — Shared utilities: `escapeHtml()`, `shuffleArray()`, `isValidSong()`, `extractYear()`

**Game modules:**

- `src/game/engine.js` — Core game logic: init, turns, placement, challenges, tokens
- `src/game/ui.js` — DOM rendering: timeline, scores, overlays, game actions
- `src/game/spotify.js` — Spotify embed playback control and retry logic
- `src/game/state.js` — State persistence: save/restore/clear to localStorage (versioned with migrations)
- `src/game/gm-panel.js` — Game Master panel: player/score/timeline editing
- `src/game/phases.js` — Game phase state machine: `Phase` enum and validated transitions

**Spotify modules:**

- `src/spotify/playlist.js` — Playlist URL parsing (extract playlist ID)
- `src/spotify/config.js` — Spotify client ID and redirect URI
- `src/spotify/oauth.js` — Spotify OAuth PKCE flow (login, token exchange, refresh)
- `src/spotify/api.js` — Authenticated Spotify Web API client (playlists, tracks)

**Data & infrastructure:**

- `songs-data.js` — Raw song database (`SONGS_DATA` array, 1200+ songs)
- `style.css` — Dark theme, CSS variables, responsive, mobile-first
- `sw.js` — Service worker for PWA offline caching
- `test.js` — Node.js unit test suite (271 tests, VM sandboxing)
- `tests/e2e/game-flow.spec.js` — Playwright E2E tests (10 browser tests)
- `tests.html` — Browser-based test suite

`App` and `Game` are object singletons (not classes) exposed on `window`. Game is composed from module method objects using `Object.defineProperties` to preserve getters. State lives in `Game` and persists to `localStorage` as `plongster-*` keys.

**Game phase state machine:** `IDLE → PASS_PHONE → LISTENING → PLACING → PLACEMENT_CONFIRM → PRE_REVEAL → CHALLENGER_PASS → CHALLENGER_PLACING → CHALLENGER_CONFIRM → REVEAL → TITLE_CLAIM → GAME_OVER`. Validated transitions prevent invalid state combinations.

**State persistence:** Versioned format (currently V2) with migration chain for backward compatibility. Saved to `localStorage` key `plongster-game`.

## Code Style

- Vanilla JS with ES modules — no npm runtime packages, no transpilation, no bundler
- 4-space indentation, enforced by ESLint + Prettier
- camelCase for variables/functions, UPPER_SNAKE for constants
- Section dividers: `// ─── Section Name ───`
- Norwegian for all user-facing text (UI, errors, labels)
- English for code (variable names, comments, commit messages)

## Development Workflow

After the user approves a plan, complete the **entire** development cycle autonomously:

1. Create feature branch from `main`
2. Implement changes
3. Run `node test.js` — fix until all tests pass
4. Run `npx playwright test` — fix until E2E tests pass
5. Verify visually with preview tools if UI changed
6. Commit, push, and create PR to `main`

Do NOT stop to ask for confirmation between these steps.

## Git Workflow

Trunk-based development — short-lived feature branches only.

- `main` is protected — all changes via PR
- Feature branches → PR to `main` → each PR gets a live preview URL
- Auto-delete branches on merge is enabled
- Commit messages: imperative mood, explain _why_ not _what_

## Testing

Always run `node test.js` and `npx playwright test` before committing.

**Unit tests** (`test.js`): Node.js VM sandboxing with mocked DOM/localStorage — no external test framework. 271 tests covering: song database validation, game init, placement logic, challenge system, token economy, timeline integrity, state migration, song validation utilities.

**E2E tests** (`tests/e2e/game-flow.spec.js`): Playwright + Chromium. 10 tests covering: welcome screen, setup flow, player management, quick start, game state persistence. Uses Python HTTP server on port 8081.

## Design Principles

- **No auth required for core experience**: The app works fully without Spotify login — playback via embed and 1200+ built-in songs. OAuth is optional for importing custom playlists (limited to 5 users under Spotify Development Mode).
- **ToS-compliant**: No scraping, no CORS proxies, no anonymous token extraction. All Spotify data access uses official authenticated APIs only.

## Key Patterns

- **Spotify playback**: Embed IFrame API with retry logic (5 retries, exponential backoff) — no auth needed
- **Spotify OAuth PKCE**: Optional login for importing custom playlists (5-user limit in Dev Mode)
- **Generation-based callbacks**: `this._generation` counter invalidates stale async operations
- **XSS prevention**: Always use `escapeHtml()` for user/song data in innerHTML
- **Service worker**: Stale-while-revalidate for app shell, network-first for navigation
- **Song validation**: `isValidSong()` and `extractYear()` in `src/utils.js` for strict import validation
- **Lazy loading**: `songs-data.js` loaded via dynamic `import()` to avoid blocking initial render

## Deploy

Two GitHub Actions workflows:

- `deploy.yml` — on push to `main`: runs unit tests + E2E, deploys to GitHub Pages (gh-pages branch)
- `pr-preview.yml` — on PR: runs unit tests + E2E, deploys preview to `/test/` (fixed URL, always shows latest PR)

## Song Database Format

```javascript
{ title: "Song Title", artist: "Artist Name", year: 2024, spotifyId: "TRACK_ID", genre: "pop", coverUrl: "https://..." }
```

Valid genres: pop, rock, hiphop, electronic, norwegian, soul, country, latin, metal, reggae, jazz, classical, disco, punk, indie, kpop, afrobeats

## Common Pitfalls

- Service worker caches aggressively — bump `CACHE_VERSION` in sw.js when changing files
- Spotify embed needs valid track IDs — validate format: 22 alphanumeric chars
- `songs-data.js` is large (~157KB) — don't read it unless modifying song data
- The app uses root-relative paths in sw.js but relative paths in HTML
- State persistence key is `plongster-game` (not `plongster-game-state`)
- Songs store must be initialized via `initSongs()` before use (async, called in `App.init()`)
