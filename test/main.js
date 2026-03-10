// Plongster — main entry point
// Composes App and Game from modules and exposes them on window

import { App } from './src/app.js';
import { engineMethods } from './src/game/engine.js';
import { uiMethods } from './src/game/ui.js';
import { spotifyMethods } from './src/game/spotify.js';
import { stateMethods } from './src/game/state.js';
import { gmMethods } from './src/game/gm-panel.js';
import { Phase } from './src/game/phases.js';
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
[engineMethods, uiMethods, spotifyMethods, stateMethods, gmMethods].forEach(methods => {
    Object.defineProperties(Game, Object.getOwnPropertyDescriptors(methods));
});

// ─── Expose on window for inline onclick handlers ───

window.App = App;
window.Game = Game;

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

// ─── Spotify IFrame API callback ───

window.onSpotifyIframeApiReady = IFrameAPI => {
    Game.spotifyAPI = IFrameAPI;
};

// ─── Spotify OAuth Setup ───

const clientIdMeta = document.querySelector('meta[name="spotify-client-id"]');
if (clientIdMeta) {
    setClientId(clientIdMeta.content);
}

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
