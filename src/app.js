// App controller — screen management, setup, playlist loading, genre filtering

import { getSongs, setSongs, resetSongs as resetSongsStore, getAllSongs } from './songs.js';
import { getAnonymousToken } from './spotify/auth.js';
import { extractPlaylistId, fetchViaWebAPI, fetchViaEmbedScraping } from './spotify/playlist.js';

export const App = {
    winCount: 10,
    defaultSongCount: getAllSongs().length,
    _loadingAbort: null,
    _loadGeneration: 0,
    _selectedGenres: new Set(),
    _usingCustomPlaylist: false,

    _genreConfig: [
        { id: 'pop', label: 'Pop', icon: '🎤' },
        { id: 'rock', label: 'Rock', icon: '🎸' },
        { id: 'hiphop', label: 'Hip-Hop', icon: '🎧' },
        { id: 'electronic', label: 'Elektronisk', icon: '🎹' },
        { id: 'norsk', label: 'Norsk', icon: '🇳🇴' },
    ],

    init() {
        document.getElementById('win-count').textContent = this.winCount;

        const savedUrl = localStorage.getItem('hitster-playlist-url');
        const playlistInput = document.getElementById('playlist-url');
        if (savedUrl && playlistInput) playlistInput.value = savedUrl;

        const cachedSongs = localStorage.getItem('hitster-playlist-songs');
        const cachedName = localStorage.getItem('hitster-playlist-name');
        if (cachedSongs) {
            try {
                const songs = JSON.parse(cachedSongs);
                if (songs.length > 0) {
                    setSongs(songs);
                    this._usingCustomPlaylist = true;
                    const badge = document.getElementById('song-source-badge');
                    const resetBtn = document.getElementById('spotify-reset-btn');
                    if (badge) {
                        badge.textContent = `${cachedName || 'Spilleliste'} (${songs.length})`;
                        badge.className = 'song-source-badge custom';
                    }
                    if (resetBtn) resetBtn.style.display = '';
                    this._showSongStatus(`${songs.length} sanger fra "${cachedName || 'Spilleliste'}".`, 'success');
                }
            } catch (e) {
                console.warn('Failed to restore cached songs:', e);
            }
        } else {
            const savedGenres = localStorage.getItem('hitster-genres');
            if (savedGenres) {
                try {
                    const genres = JSON.parse(savedGenres);
                    genres.forEach(g => this._selectedGenres.add(g));
                    this.applyGenreFilter();
                } catch (e) {}
            }
            this.updateSongBadge();
        }

        this.renderGenreChips();

        document.getElementById('player-list').addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const inputs = document.querySelectorAll('#player-list .player-name-input');
                const idx = Array.from(inputs).indexOf(e.target);
                if (idx < inputs.length - 1) {
                    inputs[idx + 1].focus();
                } else {
                    this.startGame();
                }
            }
        });

        // Restore game state if page was refreshed mid-game
        const Game = window.Game;
        if (Game.restoreState()) {
            this.showScreen('screen-game');
            Game.renderScores();
            if (Game.currentSong) {
                const cp = Game.challengePhase;
                if (cp && cp.challengerIndex !== null && cp.challengerDropIndex === null) {
                    Game.renderCurrentTurn();
                    Game.showChallengerTimeline();
                } else if (cp && cp.challengerDropIndex !== null) {
                    Game.renderCurrentTurn();
                    Game.renderTimeline();
                    Game.resolvePlacement();
                } else if (cp && cp.challengerIndex === null && cp.originalDropIndex !== null) {
                    Game.renderCurrentTurn();
                    Game.renderTimeline();
                    Game.showPreReveal();
                } else {
                    Game.startTurn(Game.currentSong);
                }
            } else {
                Game.showPassPhone();
            }
        }
    },

    // ─── Spotify Playlist Loading ───

    async loadPlaylist() {
        const input = document.getElementById('playlist-url');
        const url = input.value.trim();

        if (!url) {
            this.resetSongs();
            return;
        }

        const playlistId = extractPlaylistId(url);
        if (!playlistId) {
            this._showSongStatus('Ugyldig Spotify-URL. Lim inn en spilleliste-lenke.', 'error');
            return;
        }

        if (this._loadingAbort) this._loadingAbort.abort();
        this._loadingAbort = new AbortController();
        const generation = ++this._loadGeneration;

        const badge = document.getElementById('song-source-badge');
        const resetBtn = document.getElementById('spotify-reset-btn');
        const loadBtn = document.querySelector('.song-url-row .btn');

        badge.textContent = 'Laster...';
        badge.className = 'song-source-badge loading';
        if (loadBtn) loadBtn.disabled = true;
        this._showSongStatus('Kobler til Spotify...', 'loading');

        try {
            const signal = this._loadingAbort.signal;

            const token = await getAnonymousToken(signal);
            if (signal.aborted) return;

            let songs = null;
            let playlistName = 'Spilleliste';

            try {
                this._showSongStatus('Henter sanger fra Spotify...', 'loading');
                const apiResult = await fetchViaWebAPI(playlistId, token, signal);
                songs = apiResult.songs;
                playlistName = apiResult.name;
            } catch (apiErr) {
                if (apiErr.name === 'AbortError') throw apiErr;
                console.warn('Web API failed, falling back to embed scraping:', apiErr.message);
            }

            if (!songs || songs.length === 0) {
                this._showSongStatus('Henter spilleliste...', 'loading');
                const embedResult = await fetchViaEmbedScraping(playlistId, signal, (done, total) => {
                    this._showSongStatus(`Henter sanger... (${done}/${total})`, 'loading');
                    badge.textContent = `${done}/${total}...`;
                });
                songs = embedResult.songs;
                playlistName = embedResult.name || playlistName;
            }

            if (signal.aborted) return;

            if (!songs || songs.length === 0) {
                throw new Error('Ingen sanger med utgivelsesår funnet i spillelisten.');
            }

            const seen = new Set();
            const unique = songs.filter(s => {
                const key = `${s.title.toLowerCase()}-${s.artist.toLowerCase()}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            setSongs(unique);
            this._usingCustomPlaylist = true;
            localStorage.setItem('hitster-playlist-url', url);
            try {
                localStorage.setItem('hitster-playlist-songs', JSON.stringify(unique));
                localStorage.setItem('hitster-playlist-name', playlistName);
            } catch (e) {
                console.warn('Could not cache songs to localStorage:', e.message);
            }

            badge.textContent = `${playlistName} (${unique.length})`;
            badge.className = 'song-source-badge custom';
            this._showSongStatus(`${unique.length} sanger lastet fra "${playlistName}".`, 'success');
            resetBtn.style.display = '';
        } catch (err) {
            if (err.name === 'AbortError') return;
            badge.textContent = 'Feil';
            badge.className = 'song-source-badge error';
            this._showSongStatus(err.message, 'error');
        } finally {
            if (generation === this._loadGeneration) {
                if (loadBtn) loadBtn.disabled = false;
                this._loadingAbort = null;
            }
        }
    },

    // ─── Helpers ───

    _showSongStatus(text, type) {
        const el = document.getElementById('songs-help-text');
        if (!el) return;
        el.textContent = text;
        el.className = 'songs-help-text' + (type ? ' ' + type : '');
    },

    resetSongs() {
        localStorage.removeItem('hitster-playlist-url');
        localStorage.removeItem('hitster-playlist-songs');
        localStorage.removeItem('hitster-playlist-name');
        window.Game.clearState();
        this._usingCustomPlaylist = false;
        resetSongsStore();
        this._selectedGenres.clear();
        localStorage.removeItem('hitster-genres');
        this.applyGenreFilter();
        this.renderGenreChips();
        this.updateSongBadge();
        const badge = document.getElementById('song-source-badge');
        if (badge) badge.className = 'song-source-badge';
        const resetBtn = document.getElementById('spotify-reset-btn');
        if (resetBtn) resetBtn.style.display = 'none';
        const input = document.getElementById('playlist-url');
        if (input) input.value = '';
        this._showSongStatus('Lim inn en Spotify-spilleliste for egne sanger.', '');
    },

    updateSongBadge() {
        const badge = document.getElementById('song-source-badge');
        if (badge) {
            const count = getSongs().length;
            badge.textContent = `${count} sanger`;
            badge.className = 'song-source-badge';
        }
    },

    // ─── Genre Filtering ───

    renderGenreChips() {
        const container = document.getElementById('genre-chips');
        if (!container) return;

        if (this._usingCustomPlaylist) {
            container.style.display = 'none';
            return;
        }

        const availableGenres = new Set();
        getAllSongs().forEach(s => {
            if (s.genre) availableGenres.add(s.genre);
        });

        if (availableGenres.size === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = '';
        container.innerHTML = '';

        for (const g of this._genreConfig) {
            if (!availableGenres.has(g.id)) continue;

            const chip = document.createElement('button');
            chip.className = 'genre-chip' + (this._selectedGenres.has(g.id) ? ' active' : '');
            chip.innerHTML = `<span class="chip-icon">${g.icon}</span> ${g.label}`;
            chip.setAttribute('aria-pressed', this._selectedGenres.has(g.id));
            chip.addEventListener('click', () => this.toggleGenre(g.id));
            container.appendChild(chip);
        }
    },

    toggleGenre(genreId) {
        if (this._selectedGenres.has(genreId)) {
            this._selectedGenres.delete(genreId);
        } else {
            this._selectedGenres.add(genreId);
        }

        this.applyGenreFilter();
        this.renderGenreChips();
        localStorage.setItem('hitster-genres', JSON.stringify([...this._selectedGenres]));
    },

    applyGenreFilter() {
        if (this._usingCustomPlaylist) return;

        if (this._selectedGenres.size === 0) {
            resetSongsStore();
        } else {
            setSongs(getAllSongs().filter(s => this._selectedGenres.has(s.genre)));
        }
        window.Game.clearState();
        this.updateSongBadge();
    },

    // ─── Screen Management ───

    showScreen(screenId) {
        document.querySelectorAll('.overlay').forEach(o => o.classList.remove('active'));
        document.getElementById('gm-panel')?.classList.remove('active');
        document.getElementById('gm-backdrop')?.classList.remove('active');
        document.body.classList.remove('overlay-active');
        const confirmEl = document.querySelector('.confirm-placement');
        if (confirmEl) confirmEl.remove();

        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    },

    showSetup() {
        this.showScreen('screen-setup');
    },

    async startGame() {
        const names = this.getPlayerNames();
        if (names.length < 2) return;

        if (getSongs().length === 0) {
            alert('Ingen sanger lastet! Bruk standard sangliste eller last inn en spilleliste.');
            return;
        }

        const minSongs = names.length + this.winCount;
        if (getSongs().length < minSongs) {
            alert(
                `Trenger minst ${minSongs} sanger for ${names.length} spillere med ${this.winCount} kort. Har bare ${getSongs().length}.`,
            );
            return;
        }

        window.Game.init(names, this.winCount);
        this.showScreen('screen-game');
        window.Game.showPassPhone();
    },

    getPlayerNames() {
        const inputs = document.querySelectorAll('#player-list .player-name-input');
        const names = [];
        inputs.forEach((input, i) => {
            const name = input.value.trim() || `Spiller ${i + 1}`;
            names.push(name);
        });
        return names;
    },

    addPlayer() {
        const list = document.getElementById('player-list');
        const count = list.children.length;
        if (count >= 10) return;

        const row = document.createElement('div');
        row.className = 'player-input-row fade-in';
        row.innerHTML = `
            <input type="text" class="player-name-input" placeholder="Spiller ${count + 1}" maxlength="15" autocapitalize="words" spellcheck="false" autocomplete="off">
            <button class="btn-icon btn-remove-player" onclick="App.removePlayer(this)" aria-label="Fjern spiller">&times;</button>
        `;
        list.appendChild(row);
        this.updateRemoveButtons();
    },

    removePlayer(btn) {
        const row = btn.parentElement;
        const list = document.getElementById('player-list');
        if (list.children.length <= 2) return;
        row.remove();
        this.updateRemoveButtons();
        document.querySelectorAll('#player-list .player-name-input').forEach((input, i) => {
            input.placeholder = `Spiller ${i + 1}`;
        });
    },

    updateRemoveButtons() {
        const buttons = document.querySelectorAll('.btn-remove-player');
        const canRemove = buttons.length > 2;
        buttons.forEach(btn => {
            btn.style.visibility = canRemove ? 'visible' : 'hidden';
        });
    },

    adjustWinCount(delta) {
        this.winCount = Math.max(3, Math.min(20, this.winCount + delta));
        document.getElementById('win-count').textContent = this.winCount;
    },

    restart() {
        window.Game.stopPlayback();
        window.Game.clearState();
        this.showScreen('screen-setup');
    },
};
