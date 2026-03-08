# Hitster - Claude Code Instructions

## Project Overview
Norwegian music quiz PWA — players place songs chronologically on a timeline.
Vanilla JavaScript, no frameworks, no build step. Deployed as static files to GitHub Pages.

Live: https://chaerem.github.io/Hitster/
Test/preview: https://chaerem.github.io/Hitster/test/

## Commands

```bash
# Dev server
python3 -m http.server 8080

# Run tests (must pass before any commit)
node test.js

# Generate songs from Spotify playlist
node tools/generate-songs.js <spotify-playlist-url>
```

## Architecture

Single-page app with 5 screens managed by showing/hiding divs (no router):
- `index.html` — All UI screens and overlays
- `app.js` — App controller: Spotify loading, playlist fetching, screen management
- `game.js` — Game logic: state, turns, challenges, tokens, timeline, rendering
- `songs.js` — Song database (`SONGS_DATABASE` array, 1200+ songs)
- `style.css` — Dark theme, CSS variables, responsive, mobile-first
- `sw.js` — Service worker for PWA offline caching
- `test.js` — Node.js test suite (no external dependencies)

`App` and `Game` are object singletons (not classes). State lives in `Game` and persists to `localStorage` as `hitster-*` keys.

## Code Style

- Vanilla JS only — no npm packages, no transpilation, no modules
- 4-space indentation
- camelCase for variables/functions, UPPER_SNAKE for constants
- Section dividers: `// ─── Section Name ───`
- Norwegian for all user-facing text (UI, errors, labels)
- English for code (variable names, comments, commit messages)

## Development Workflow

After the user approves a plan, complete the **entire** development cycle autonomously:
1. Create feature branch from `main`
2. Implement changes
3. Run `node test.js` — fix until all tests pass
4. Verify visually with preview tools if UI changed
5. Commit, push, and create PR to `main`

Do NOT stop to ask for confirmation between these steps.

## Git Workflow

Trunk-based development — short-lived feature branches only.

- `main` is protected — all changes via PR
- Feature branches → PR to `main` → each PR gets a live preview URL
- Auto-delete branches on merge is enabled
- Commit messages: imperative mood, explain *why* not *what*

## Testing

Always run `node test.js` before committing. Tests use Node.js VM sandboxing with mocked DOM/localStorage — no external test framework.

Test categories: song database validation, game init, placement logic, challenge system, token economy, timeline integrity, full integration.

## Key Patterns

- **Spotify playback**: Embed IFrame API with retry logic (5 retries, exponential backoff)
- **API fallback chain**: Spotify Web API (anon token) → embed page scraping → CORS proxy
- **Generation-based callbacks**: `this._generation` counter invalidates stale async operations
- **XSS prevention**: Always use `escapeHtml()` for user/song data in innerHTML
- **Service worker**: Stale-while-revalidate for app shell, network-first for navigation

## Deploy

Two GitHub Actions workflows:
- `deploy.yml` — on push to `main`: runs tests, deploys to GitHub Pages (gh-pages branch)
- `pr-preview.yml` — on PR: runs tests, deploys preview to `/test/` (fixed URL, always shows latest PR)

## Song Database Format

```javascript
{ title: "Song Title", artist: "Artist Name", year: 2024, spotifyId: "TRACK_ID", genre: "pop" }
```

Valid genres: pop, rock, hiphop, electronic, norwegian, soul, country, latin, metal, reggae, jazz, classical, disco, punk, indie, kpop, afrobeats

## Common Pitfalls

- Service worker caches aggressively — bump `CACHE_VERSION` in sw.js when changing files
- Spotify embed needs valid track IDs — validate format: 22 alphanumeric chars
- `songs.js` is large (~157KB) — don't read it unless modifying song data
- The app uses root-relative paths in sw.js but relative paths in HTML
