// Spotify embed playback control
// Manages the IFrame API controller, loading, retries, and UI state

import { Phase, transition } from './phases.js';

export const spotifyMethods = {
    _loadGeneration: 0,
    _loadTimeout: null,

    _isValidSpotifyId(id) {
        return typeof id === 'string' && /^[a-zA-Z0-9]{10,30}$/.test(id);
    },

    loadSong(spotifyId) {
        if (!this._isValidSpotifyId(spotifyId)) {
            console.warn('Invalid spotifyId, skipping load:', spotifyId);
            return;
        }

        this._loadGeneration++;
        const gen = this._loadGeneration;
        this._isPlaying = false;

        if (this._loadTimeout) {
            clearTimeout(this._loadTimeout);
            this._loadTimeout = null;
        }

        this._updatePlaybackUI('loading');

        if (!this.spotifyAPI) {
            if (!this._apiRetryCount) this._apiRetryCount = 0;
            if (this._apiRetryCount < 5) {
                this._apiRetryCount++;
                this._loadTimeout = setTimeout(() => {
                    if (gen !== this._loadGeneration) return;
                    this.loadSong(spotifyId);
                }, 800);
                return;
            }
            this._apiRetryCount = 0;
            this.stopPlayback();
            this._updatePlaybackUI('error');
            return;
        }
        this._apiRetryCount = 0;

        const uri = `spotify:track:${spotifyId}`;

        if (this.embedController) {
            try {
                this.embedController.loadUri(uri);
                this._loadTimeout = setTimeout(() => {
                    if (gen !== this._loadGeneration) return;
                    console.warn('loadUri timeout, creating fresh controller');
                    this.stopPlayback();
                    this._createSpotifyController(spotifyId, gen, 0);
                }, 3000);
                return;
            } catch (e) {
                console.warn('loadUri failed, creating fresh controller:', e);
            }
        }

        this.stopPlayback();
        this._createSpotifyController(spotifyId, gen, 0);
    },

    _setupListeners(controller) {
        controller.addListener('ready', () => {
            if (this._loadTimeout) {
                clearTimeout(this._loadTimeout);
                this._loadTimeout = null;
            }
            this._updatePlaybackUI('ready');
        });

        controller.addListener('playback_update', e => {
            if (!e.data) return;

            if (!e.data.isPaused && !e.data.isBuffering) {
                this._isPlaying = true;
                if (this._loadTimeout) {
                    clearTimeout(this._loadTimeout);
                    this._loadTimeout = null;
                }
                this._updatePlaybackUI('playing');
                if (!this.hasPlayedSong) {
                    this.hasPlayedSong = true;
                    if (this.gamePhase === Phase.LISTENING) {
                        this.gamePhase = transition(this.gamePhase, Phase.PLACING);
                    }
                    this.renderTimeline();
                    this.renderGameActions();
                }
            } else if (e.data.isPaused) {
                const wasPlaying = this._isPlaying;
                this._isPlaying = false;
                if (wasPlaying && e.data.position === 0) {
                    this._updatePlaybackUI('paused');
                    const text = document.querySelector('.listening-text');
                    if (text) text.textContent = 'Sangen er ferdig — trykk for å spille igjen';
                } else {
                    this._updatePlaybackUI('paused');
                }
            }
        });
    },

    _createSpotifyController(spotifyId, gen, attempt) {
        if (gen !== this._loadGeneration) return;

        this.embedController = null;

        const uri = `spotify:track:${spotifyId}`;
        const container = document.getElementById('spotify-embed');
        container.innerHTML = '<div id="spotify-iframe"></div>';
        const iframeEl = document.getElementById('spotify-iframe');

        if (attempt > 0) {
            document.querySelector('.listening-text').textContent = 'Prøver igjen...';
        }

        this._loadTimeout = setTimeout(() => {
            if (gen !== this._loadGeneration) return;

            if (attempt < 2) {
                console.warn(`Spotify embed timeout (attempt ${attempt + 1}), retrying...`);
                this.embedController = null;
                container.innerHTML = '';
                this._createSpotifyController(spotifyId, gen, attempt + 1);
            } else {
                console.warn('Spotify embed timeout after retries');
                this._updatePlaybackUI('ready');
                document.querySelector('.listening-text').textContent = 'Trykk for å prøve igjen';
            }
        }, 4000);

        try {
            this.spotifyAPI.createController(iframeEl, { uri, height: 152, width: '100%', theme: 0 }, controller => {
                if (gen !== this._loadGeneration) return;
                this.embedController = controller;
                this._setupListeners(controller);
            });
        } catch (e) {
            console.error('Spotify createController error:', e);
            if (gen !== this._loadGeneration) return;
            if (this._loadTimeout) {
                clearTimeout(this._loadTimeout);
                this._loadTimeout = null;
            }
            this._updatePlaybackUI('ready');
            document.querySelector('.listening-text').textContent = 'Trykk for å prøve igjen';
        }
    },

    _updatePlaybackUI(state) {
        const playPauseBtn = document.getElementById('btn-play-pause');
        const replayBtn = document.getElementById('btn-replay');
        const bars = document.getElementById('listening-bars');
        const text = document.querySelector('.listening-text');
        const controls = document.getElementById('playback-controls');

        if (!playPauseBtn || !bars || !text || !controls) return;

        const playIcon =
            '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
        const pauseIcon =
            '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>';

        switch (state) {
            case 'loading':
                playPauseBtn.innerHTML = playIcon;
                playPauseBtn.disabled = true;
                playPauseBtn.style.opacity = '0.4';
                if (replayBtn) {
                    replayBtn.disabled = true;
                    replayBtn.style.opacity = '0.4';
                }
                bars.style.display = 'none';
                controls.style.display = 'flex';
                text.textContent = 'Laster sang...';
                break;

            case 'ready':
                playPauseBtn.innerHTML = playIcon;
                playPauseBtn.disabled = false;
                playPauseBtn.style.opacity = '';
                if (replayBtn) {
                    replayBtn.disabled = false;
                    replayBtn.style.opacity = '';
                }
                bars.style.display = 'none';
                controls.style.display = 'flex';
                text.textContent = 'Trykk for å spille';
                break;

            case 'playing':
                playPauseBtn.innerHTML = pauseIcon;
                playPauseBtn.disabled = false;
                playPauseBtn.style.opacity = '';
                if (replayBtn) {
                    replayBtn.disabled = false;
                    replayBtn.style.opacity = '';
                }
                bars.style.display = 'flex';
                controls.style.display = 'flex';
                text.textContent = 'Lytt og plasser sangen i tidslinjen';
                break;

            case 'paused':
                playPauseBtn.innerHTML = playIcon;
                playPauseBtn.disabled = false;
                playPauseBtn.style.opacity = '';
                if (replayBtn) {
                    replayBtn.disabled = false;
                    replayBtn.style.opacity = '';
                }
                bars.style.display = 'none';
                controls.style.display = 'flex';
                text.textContent = 'Trykk for å spille';
                break;

            case 'error':
                playPauseBtn.innerHTML = playIcon;
                playPauseBtn.disabled = false;
                playPauseBtn.style.opacity = '';
                if (replayBtn) {
                    replayBtn.disabled = false;
                    replayBtn.style.opacity = '';
                }
                bars.style.display = 'none';
                controls.style.display = 'flex';
                text.innerHTML =
                    'Spotify kunne ikke lastes.<br>' +
                    '<button class="btn btn-ghost btn-sm" onclick="Game.replayFromStart()" style="margin-top:8px">Prøv igjen</button> ' +
                    '<button class="btn btn-ghost btn-sm" onclick="Game.skipSong()" style="margin-top:8px">Hopp over</button>';
                break;
        }
    },

    pausePlayback() {
        if (this._loadTimeout) {
            clearTimeout(this._loadTimeout);
            this._loadTimeout = null;
        }
        if (this.embedController && this._isPlaying) {
            try {
                this.embedController.togglePlay();
            } catch (e) {}
            this._isPlaying = false;
        }
    },

    stopPlayback() {
        if (this._loadTimeout) {
            clearTimeout(this._loadTimeout);
            this._loadTimeout = null;
        }
        if (this.embedController) {
            if (this._isPlaying) {
                try {
                    this.embedController.togglePlay();
                } catch (e) {}
            }
            this.embedController = null;
        }
        this._isPlaying = false;
        const container = document.getElementById('spotify-embed');
        if (container) container.innerHTML = '';
    },

    togglePlay() {
        if (this.embedController) {
            try {
                this.embedController.togglePlay();
            } catch (e) {
                console.error('togglePlay error:', e);
                if (this.currentSong && this._isValidSpotifyId(this.currentSong.spotifyId)) {
                    this.loadSong(this.currentSong.spotifyId);
                }
                return;
            }
        } else if (this.currentSong && this._isValidSpotifyId(this.currentSong.spotifyId)) {
            this.loadSong(this.currentSong.spotifyId);
            return;
        }
        document.querySelector('.listening-text').textContent = 'Starter avspilling...';
    },

    skipSong() {
        this.pausePlayback();
        this.currentSong = this.drawSong();
        if (!this.currentSong) return;
        this.hasPlayedSong = false;
        this.isWaitingForPlacement = true;
        this.selectedDropIndex = null;
        this.saveState();
        this.renderTimeline();
        if (this.currentSong && this._isValidSpotifyId(this.currentSong.spotifyId)) {
            this.loadSong(this.currentSong.spotifyId);
        } else {
            this._updatePlaybackUI('error');
        }
    },

    skipSongWithToken() {
        if (this._skipDebounce) return;
        this._skipDebounce = true;
        setTimeout(() => {
            this._skipDebounce = false;
        }, 500);

        const player = this.currentPlayer;
        if (player.tokens < 1) return;
        player.tokens -= 1;
        this.skipSong();
        this.renderScores();
        this.renderGameActions();
    },

    tradeTokensForCard() {
        if (this._tradeDebounce) return;
        this._tradeDebounce = true;
        setTimeout(() => {
            this._tradeDebounce = false;
        }, 500);

        const player = this.currentPlayer;
        if (player.tokens < 3) return;

        const card = this.drawSong();
        if (!card) return;

        player.tokens -= 3;

        let insertIdx = player.timeline.findIndex(c => c.year >= card.year);
        if (insertIdx === -1) insertIdx = player.timeline.length;
        player.timeline.splice(insertIdx, 0, {
            title: card.title,
            artist: card.artist,
            year: card.year,
        });
        player.score = player.timeline.length;

        this.saveState();
        this.renderScores();
        this.renderTimeline();
        this.renderGameActions();

        if (player.score >= this.cardsToWin) {
            this.showWinner(player);
        }
    },

    replayFromStart() {
        if (this.currentSong && this._isValidSpotifyId(this.currentSong.spotifyId)) {
            this.loadSong(this.currentSong.spotifyId);
        }
    },
};
