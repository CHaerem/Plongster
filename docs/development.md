# Development Guide

## Prerequisites

- Node.js 18+
- Python 3 (for dev server)

## Getting Started

```bash
git clone git@github.com:CHaerem/Plongster.git
cd Plongster
npm install          # Dev dependencies only (ESLint, Prettier, Playwright)
python3 -m http.server 8080  # Start dev server
```

Open http://localhost:8080 in your browser.

## Project Structure

```
Plongster/
├── index.html              # All UI screens
├── main.js                 # Entry point, composes Game singleton
├── songs-data.js           # Song database (~1200 songs, auto-generated)
├── style.css               # Dark theme, responsive
├── sw.js                   # Service worker
├── manifest.json           # PWA manifest
├── src/
│   ├── app.js              # App controller
│   ├── songs.js            # Songs store (lazy loads songs-data.js)
│   ├── utils.js            # Shared utilities
│   ├── game/
│   │   ├── engine.js       # Game logic
│   │   ├── ui.js           # DOM rendering
│   │   ├── spotify.js      # Playback control
│   │   ├── state.js        # State persistence
│   │   ├── gm-panel.js     # Game Master panel
│   │   └── phases.js       # Phase state machine
│   └── spotify/
│       ├── playlist.js      # Playlist URL parsing
│       ├── config.js        # OAuth config
│       ├── oauth.js         # OAuth PKCE flow
│       └── api.js           # Authenticated API client
├── tests/
│   └── e2e/
│       └── game-flow.spec.js  # Playwright E2E tests
├── tools/
│   └── generate-songs.js   # Song database generator
├── icons/                   # PWA icons (192, 512, maskable)
├── docs/                    # Documentation
└── .github/workflows/       # CI/CD
```

## Running Tests

```bash
# Unit tests (271 tests, must pass before commit)
node test.js

# E2E tests (10 Playwright tests)
npx playwright test

# Run a specific E2E test
npx playwright test -g "welcome screen"

# Lint
npx eslint .

# Format check
npx prettier --check .
```

## Code Style

- **Vanilla JS** with ES modules — no runtime dependencies
- **4-space indentation** enforced by Prettier
- **Norwegian** for user-facing text, **English** for code
- Use `escapeHtml()` from `src/utils.js` for any user/song data in innerHTML

## Making Changes

1. Create a feature branch from `main`
2. Make changes
3. Run `node test.js` and `npx playwright test`
4. Format: `npx prettier --write .`
5. Commit, push, create PR to `main`

The PR will automatically:

- Run unit tests and E2E tests
- Deploy a preview to https://chaerem.github.io/Plongster/test/

## Service Worker

When modifying any cached file, bump `CACHE_VERSION` in `sw.js` (e.g., `plongster-v36` → `plongster-v37`). The app shell list in `sw.js` must include all JS modules.

During development, you may want to unregister the service worker via DevTools > Application > Service Workers to avoid stale caches.

## Adding Songs

Use the generator tool:

```bash
# Set up credentials
cp tools/.env.example tools/.env
# Edit tools/.env with your Spotify credentials

# Generate from a playlist
node tools/generate-songs.js https://open.spotify.com/playlist/...

# Append to existing database
node tools/generate-songs.js --append https://open.spotify.com/playlist/...
```

## CI/CD

- **`deploy.yml`** — On push to `main`: runs all tests, deploys to GitHub Pages
- **`pr-preview.yml`** — On PR: runs all tests, deploys preview to `/test/`
