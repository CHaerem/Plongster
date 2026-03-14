// Plongster — main entry point
// Composes App and Game from modules and exposes them on window

import { App } from './src/app.js';
import { engineMethods } from './src/game/engine.js';
import { placementMethods } from './src/game/placement.js';
import { challengeMethods } from './src/game/challenges.js';
import { uiMethods } from './src/game/ui.js';
import { spotifyMethods } from './src/game/spotify.js';
import { stateMethods } from './src/game/state.js';
import { gmMethods } from './src/game/gm-panel.js';
import { Phase } from './src/game/phases.js';
import { on, onInput, initEvents } from './src/events.js';
import { setClientId } from './src/spotify/config.js';
import { handleCallback } from './src/spotify/oauth.js';

// ─── Build Game singleton from modules ───

const Game = {
    // State properties
    players: [],
    currentPlayerIndex: 0,
    cardsToWin: 10,
    deck: [],
    currentSong: null,
    usedSongs: new Set(),
    isWaitingForPlacement: false,
    selectedDropIndex: null,
    spotifyAPI: null,
    embedController: null,
    hasPlayedSong: false,
    _isPlaying: false,
    challengePhase: null,
    titleArtistClaimed: false,
    gamePhase: Phase.IDLE,
    MAX_TOKENS: 5,
};

// Merge methods from all modules, preserving getters (e.g., currentPlayer)
[engineMethods, placementMethods, challengeMethods, uiMethods, spotifyMethods, stateMethods, gmMethods].forEach(
    methods => {
        Object.defineProperties(Game, Object.getOwnPropertyDescriptors(methods));
    },
);

// ─── Expose on window ───

window.App = App;
window.Game = Game;

// ─── Register event handlers ───

// App: welcome screen
on('show-setup', () => App.showSetup());
on('quick-start', () => App.quickStart());
on('show-how-to-play', () => App.showScreen('screen-how-to-play'));
on('show-welcome', () => App.showScreen('screen-welcome'));
on('install-app', () => window.installApp?.());

// App: guide
on('guide-prev', () => App.guideStep(-1));
on('guide-next', () => App.guideStep(1));

// App: setup screen
on('add-player', () => App.addPlayer());
on('remove-player', el => App.removePlayer(el));
on('adjust-win-count', el => App.adjustWinCount(parseInt(el.dataset.delta)));
on('spotify-login', () => App.spotifyLogin());
on('spotify-logout', () => App.spotifyLogout());
on('load-more-playlists', () => App.loadMorePlaylists());
on('load-playlist', () => App.loadPlaylist());
on('reset-songs', () => App.resetSongs());
on('start-game', () => App.startGame());
on('restart', () => App.restart());

// Game: playback controls
on('toggle-play', () => Game.togglePlay());
on('replay', () => Game.replayFromStart());
on('skip-song', () => Game.skipSong());

// Game: timeline placement (dynamic from renderTimeline)
on('drop-zone', el => Game.onDropZoneClick(parseInt(el.dataset.index)));
on('challenger-drop-zone', el => Game.onChallengerDropZoneClick(parseInt(el.dataset.index)));

// Game: placement confirmation (dynamic from _showPlacementDialog)
on('confirm-placement', () => Game.confirmPlacement());
on('cancel-placement', () => Game.cancelPlacement());
on('confirm-challenger-placement', () => Game.confirmChallengerPlacement());
on('cancel-challenger-placement', () => Game.cancelChallengerPlacement());

// Game: pre-reveal / challenge flow
on('toggle-title-claim', () => Game.toggleTitleClaim());
on('skip-challenge', () => Game.skipChallenge());
on('start-challenge', () => Game.startChallenge());
on('cancel-challenge', () => Game.cancelChallenge());
on('select-challenger', el => Game.selectChallenger(parseInt(el.dataset.player)));
on('cancel-challenge-refund', () => Game.cancelChallengeRefund());
on('show-challenger-timeline', () => Game.showChallengerTimeline());
on('cancel-challenge-from-timeline', () => Game.cancelChallengeFromTimeline());

// Game: reveal / turn management
on('confirm-title-claim-correct', () => Game.confirmTitleClaim(true));
on('confirm-title-claim-wrong', () => Game.confirmTitleClaim(false));
on('next-turn', () => Game.nextTurn());
on('player-ready', () => Game.onPlayerReady());

// Game: spotify token actions (dynamic from renderGameActions)
on('skip-song-with-token', () => Game.skipSongWithToken());
on('trade-tokens', () => Game.tradeTokensForCard());

// Game: GM panel
on('toggle-menu', () => Game.toggleMenu());
on('close-menu', () => Game.closeMenu());
on('gm-move-player', el => Game.gmMovePlayer(parseInt(el.dataset.player), parseInt(el.dataset.dir)));
on('gm-adjust-score', el => Game.gmAdjustScore(parseInt(el.dataset.player), parseInt(el.dataset.delta)));
on('gm-adjust-tokens', el => Game.gmAdjustTokens(parseInt(el.dataset.player), parseInt(el.dataset.delta)));
on('gm-remove-player', el => Game.gmRemovePlayer(parseInt(el.dataset.player)));
on('gm-add-player', () => Game.gmAddPlayer());
on('gm-skip-song', () => {
    Game.skipSong();
    Game.closeMenu();
});
on('gm-restart', () => Game.gmRestart());
on('gm-remove-card', el => Game.gmRemoveCard(parseInt(el.dataset.player), parseInt(el.dataset.card)));
on('gm-start-edit-card', el => Game.gmStartEditCard(parseInt(el.dataset.player), parseInt(el.dataset.card)));
on('gm-save-edit-card', el => Game.gmSaveEditCard(parseInt(el.dataset.player), parseInt(el.dataset.card)));
on('gm-cancel-edit-card', () => Game.gmCancelEditCard());
on('gm-add-random-card', el => Game.gmAddRandomCard(parseInt(el.dataset.player)));
on('gm-add-searched-card', el => Game.gmAddSearchedCard(parseInt(el.dataset.player), parseInt(el.dataset.songIndex)));
on('gm-start-edit-song', () => Game.gmStartEditSong());
on('gm-save-edit-song', () => Game.gmSaveEditSong());
on('gm-cancel-edit-song', () => Game.gmCancelEditSong());

// GM panel: timeline player select (input handler)
onInput('gm-render-timeline', () => Game.gmRenderTimeline());

// GM panel: song search (input handler)
onInput('gm-search-song', el => Game.gmSearchSong(el.value, parseInt(el.dataset.player)));

// Initialize event delegation
initEvents();

// ─── Keyboard shortcuts ───

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (document.getElementById('gm-panel').classList.contains('active')) {
            Game.closeMenu();
            return;
        }
        if (Game._challengerMode && Game.selectedDropIndex !== null) {
            Game.cancelChallengerPlacement();
            return;
        }
        if (Game.selectedDropIndex !== null) {
            Game.cancelPlacement();
        }
    }
});

// ─── Global Error Handling ───

window.onerror = (msg, source, line, col, error) => {
    console.error('Uncaught error:', { msg, source, line, col, stack: error?.stack });
};

window.addEventListener('unhandledrejection', event => {
    console.error('Unhandled promise rejection:', event.reason);
});

// ─── Spotify IFrame API callback ───
// The promise is created in an inline script before the SDK loads,
// so it captures the API even if the callback fires before this module runs
window._spotifyAPIPromise.then(IFrameAPI => {
    Game.spotifyAPI = IFrameAPI;
});

// ─── Spotify OAuth Setup ───

const clientIdMeta = document.querySelector('meta[name="spotify-client-id"]');
if (clientIdMeta) {
    setClientId(clientIdMeta.content);
}

// ─── PWA Install Prompt ───

let _deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _deferredInstallPrompt = e;
    const btn = document.getElementById('btn-install');
    if (btn) btn.style.display = '';
});

window.addEventListener('appinstalled', () => {
    _deferredInstallPrompt = null;
    const btn = document.getElementById('btn-install');
    if (btn) btn.style.display = 'none';
});

window.installApp = async () => {
    if (!_deferredInstallPrompt) return;
    _deferredInstallPrompt.prompt();
    const { outcome } = await _deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
        _deferredInstallPrompt = null;
        const btn = document.getElementById('btn-install');
        if (btn) btn.style.display = 'none';
    }
};

// ─── Network status detection ───

function updateOfflineBanner() {
    const banner = document.getElementById('offline-banner');
    if (banner) banner.style.display = navigator.onLine ? 'none' : '';
}

window.addEventListener('online', () => {
    updateOfflineBanner();
    Game._showNotification('Tilkoblet igjen');
});

window.addEventListener('offline', () => {
    updateOfflineBanner();
    if (Game._isPlaying) {
        Game.pausePlayback();
    }
});

// Handle OAuth callback before app init
(async () => {
    if (window.location.search.includes('code=')) {
        await handleCallback();
    }
    await App.init();
    updateOfflineBanner();
})();
