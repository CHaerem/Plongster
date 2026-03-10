// App controller — screen management, setup, playlist loading, genre filtering

import { initSongs, getSongs, setSongs, resetSongs as resetSongsStore, getAllSongs } from './songs.js';
import { extractPlaylistId } from './spotify/playlist.js';
import { SPOTIFY_CONFIG } from './spotify/config.js';
import { isLoggedIn, getUsername, startLogin, logout } from './spotify/oauth.js';
import { fetchUserPlaylists, fetchPlaylistTracks } from './spotify/api.js';

// ─── Migrate localStorage keys from old "hitster-" prefix ───

function migrateLocalStorageKeys() {
    const keyMap = [
        ['hitster-game', 'plongster-game'],
        ['hitster-playlist-url', 'plongster-playlist-url'],
        ['hitster-playlist-songs', 'plongster-playlist-songs'],
        ['hitster-playlist-name', 'plongster-playlist-name'],
        ['hitster-genres', 'plongster-genres'],
        ['hitster-player-names', 'plongster-player-names'],
        ['hitster-spotify-token', 'plongster-spotify-token'],
        ['hitster-spotify-verifier', 'plongster-spotify-verifier'],
        ['hitster-spotify-user', 'plongster-spotify-user'],
    ];
    for (const [oldKey, newKey] of keyMap) {
        if (localStorage.getItem(oldKey) !== null && localStorage.getItem(newKey) === null) {
            localStorage.setItem(newKey, localStorage.getItem(oldKey));
            localStorage.removeItem(oldKey);
        }
    }
}

migrateLocalStorageKeys();

export const App = {
    winCount: 10,
    _loadingAbort: null,
    _loadGeneration: 0,
    _selectedGenres: new Set(),
    _usingCustomPlaylist: false,
    _playlistOffset: 0,
    _playlistTotal: 0,
    _allPlaylists: [],

    _genreConfig: [
        { id: 'pop', label: 'Pop', icon: '🎤' },
        { id: 'rock', label: 'Rock', icon: '🎸' },
        { id: 'hiphop', label: 'Hip-Hop', icon: '🎧' },
        { id: 'electronic', label: 'Elektronisk', icon: '🎹' },
        { id: 'norsk', label: 'Norsk', icon: '🇳🇴' },
    ],

    async init() {
        await initSongs();
        document.getElementById('win-count').textContent = this.winCount;

        const savedUrl = localStorage.getItem('plongster-playlist-url');
        const playlistInput = document.getElementById('playlist-url');
        if (savedUrl && playlistInput) playlistInput.value = savedUrl;

        const cachedSongs = localStorage.getItem('plongster-playlist-songs');
        const cachedName = localStorage.getItem('plongster-playlist-name');
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
            const savedGenres = localStorage.getItem('plongster-genres');
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
        this.renderSpotifyAccount();

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

        // Playlist import requires Spotify login
        if (!isLoggedIn()) {
            this._showSongStatus('Logg inn med Spotify for å importere spillelister.', 'error');
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
        this._showSongStatus('Henter sanger fra Spotify...', 'loading');

        try {
            const signal = this._loadingAbort.signal;

            const result = await fetchPlaylistTracks(playlistId, signal, (done, total) => {
                this._showSongStatus(`Henter sanger... (${done}/${total})`, 'loading');
                badge.textContent = `${done}/${total}...`;
            });

            if (signal.aborted) return;

            const songs = result.songs;
            const playlistName = result.name;

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
            localStorage.setItem('plongster-playlist-url', url);
            try {
                localStorage.setItem('plongster-playlist-songs', JSON.stringify(unique));
                localStorage.setItem('plongster-playlist-name', playlistName);
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

    // ─── Spotify Account ───

    renderSpotifyAccount() {
        const container = document.getElementById('spotify-account');
        const loginBtn = document.getElementById('spotify-login-btn');
        const userInfo = document.getElementById('spotify-user-info');
        const playlistsEl = document.getElementById('spotify-playlists');
        if (!container) return;

        // Only show if client ID is configured
        if (!SPOTIFY_CONFIG.clientId) {
            container.style.display = 'none';
            if (playlistsEl) playlistsEl.style.display = 'none';
            return;
        }

        container.style.display = '';

        if (isLoggedIn()) {
            loginBtn.style.display = 'none';
            userInfo.style.display = '';
            const nameEl = document.getElementById('spotify-user-name');
            nameEl.textContent = getUsername() || 'Tilkoblet';
            // Auto-load playlists
            if (!this._usingCustomPlaylist) {
                this.loadPlaylists();
            }
        } else {
            loginBtn.style.display = '';
            userInfo.style.display = 'none';
            if (playlistsEl) playlistsEl.style.display = 'none';
        }
    },

    spotifyLogin() {
        startLogin();
    },

    spotifyLogout() {
        logout();
        this.resetSongs();
        this.renderSpotifyAccount();
    },

    async loadPlaylists() {
        const container = document.getElementById('spotify-playlists');
        const grid = document.getElementById('spotify-playlist-grid');
        if (!container || !grid) return;

        this._playlistOffset = 0;
        this._allPlaylists = [];
        container.style.display = '';
        grid.innerHTML = '<p class="playlist-status">Laster spillelister...</p>';

        const searchInput = document.getElementById('playlist-search');
        if (searchInput) {
            searchInput.value = '';
            searchInput.oninput = () => this._filterPlaylists();
        }

        try {
            const result = await fetchUserPlaylists(0, 50);
            this._playlistOffset = 50;
            this._playlistTotal = result.total;
            this._allPlaylists = result.items;

            this._renderPlaylistGrid();

            const loadMoreBtn = document.getElementById('spotify-load-more');
            if (loadMoreBtn) {
                loadMoreBtn.style.display = result.hasMore ? '' : 'none';
            }
        } catch (e) {
            grid.innerHTML = `<p class="playlist-status playlist-error">${this._escapeAttr(e.message)}</p>`;
        }
    },

    async loadMorePlaylists() {
        const loadMoreBtn = document.getElementById('spotify-load-more');

        try {
            if (loadMoreBtn) loadMoreBtn.disabled = true;
            const result = await fetchUserPlaylists(this._playlistOffset, 50);
            this._playlistOffset += 50;

            this._allPlaylists = this._allPlaylists.concat(result.items);
            this._renderPlaylistGrid();

            if (loadMoreBtn) {
                loadMoreBtn.style.display = result.hasMore ? '' : 'none';
                loadMoreBtn.disabled = false;
            }
        } catch (e) {
            if (loadMoreBtn) loadMoreBtn.disabled = false;
        }
    },

    _filterPlaylists() {
        this._renderPlaylistGrid();
    },

    _getFilteredPlaylists() {
        const searchInput = document.getElementById('playlist-search');
        const query = (searchInput?.value || '').toLowerCase().trim();
        if (!query) return this._allPlaylists;
        return this._allPlaylists.filter(
            p => p.name.toLowerCase().includes(query) || p.owner.toLowerCase().includes(query),
        );
    },

    _renderPlaylistGrid() {
        const grid = document.getElementById('spotify-playlist-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const filtered = this._getFilteredPlaylists();

        if (this._allPlaylists.length === 0) {
            grid.innerHTML = '<p class="playlist-status">Ingen spillelister funnet.</p>';
            return;
        }

        if (filtered.length === 0) {
            grid.innerHTML = '<p class="playlist-status">Ingen treff.</p>';
            return;
        }

        for (const pl of filtered) {
            grid.appendChild(this._createPlaylistCard(pl));
        }
    },

    _createPlaylistCard(playlist) {
        const card = document.createElement('button');
        card.className = 'spotify-playlist-card';
        card.onclick = () => this.selectPlaylist(playlist.id, playlist.name);

        const img = playlist.imageUrl
            ? `<img src="${playlist.imageUrl}" alt="" class="playlist-cover" loading="lazy">`
            : '<div class="playlist-cover playlist-cover-empty"></div>';

        card.innerHTML = `
            ${img}
            <div class="playlist-info">
                <span class="playlist-name">${this._escapeAttr(playlist.name)}</span>
                <span class="playlist-meta">${playlist.trackCount} sanger</span>
            </div>
        `;
        return card;
    },

    _escapeAttr(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    async selectPlaylist(playlistId, playlistName) {
        if (this._loadingAbort) this._loadingAbort.abort();
        this._loadingAbort = new AbortController();
        const generation = ++this._loadGeneration;

        const badge = document.getElementById('song-source-badge');
        const resetBtn = document.getElementById('spotify-reset-btn');

        badge.textContent = 'Laster...';
        badge.className = 'song-source-badge loading';
        this._showSongStatus(`Henter "${playlistName}"...`, 'loading');

        try {
            const signal = this._loadingAbort.signal;
            const result = await fetchPlaylistTracks(playlistId, signal, (done, total) => {
                this._showSongStatus(`Henter sanger... (${done}/${total})`, 'loading');
                badge.textContent = `${done}/${total}...`;
            });

            if (signal.aborted) return;

            const songs = result.songs;
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
            try {
                localStorage.setItem('plongster-playlist-songs', JSON.stringify(unique));
                localStorage.setItem('plongster-playlist-name', playlistName);
            } catch (e) {
                console.warn('Could not cache songs to localStorage:', e.message);
            }

            badge.textContent = `${playlistName} (${unique.length})`;
            badge.className = 'song-source-badge custom';
            this._showSongStatus(`${unique.length} sanger lastet fra "${playlistName}".`, 'success');
            resetBtn.style.display = '';

            // Hide playlist browser after selection
            const playlistsEl = document.getElementById('spotify-playlists');
            if (playlistsEl) playlistsEl.style.display = 'none';
        } catch (err) {
            if (err.name === 'AbortError') return;
            badge.textContent = 'Feil';
            badge.className = 'song-source-badge error';
            this._showSongStatus(err.message, 'error');
        } finally {
            if (generation === this._loadGeneration) {
                this._loadingAbort = null;
            }
        }
    },

    // ─── Helpers ───

    _showSongStatus(text, type) {
        const el = document.getElementById('songs-help-text');
        if (!el) return;
        el.textContent = text;
        el.className = `songs-help-text${type ? ` ${type}` : ''}`;
    },

    resetSongs() {
        localStorage.removeItem('plongster-playlist-url');
        localStorage.removeItem('plongster-playlist-songs');
        localStorage.removeItem('plongster-playlist-name');
        window.Game.clearState();
        this._usingCustomPlaylist = false;
        resetSongsStore();
        this._selectedGenres.clear();
        localStorage.removeItem('plongster-genres');
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
        // Re-show playlist browser if logged in
        if (isLoggedIn() && SPOTIFY_CONFIG.clientId) {
            this.loadPlaylists();
        }
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
            chip.className = `genre-chip${this._selectedGenres.has(g.id) ? ' active' : ''}`;
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
        localStorage.setItem('plongster-genres', JSON.stringify([...this._selectedGenres]));
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
        this._restorePlayerNames();
    },

    _restorePlayerNames() {
        const saved = this._getSavedPlayerNames();
        if (saved.length < 2) return;

        const list = document.getElementById('player-list');
        const inputs = list.querySelectorAll('.player-name-input');

        // Fill existing inputs
        inputs.forEach((input, i) => {
            if (i < saved.length) input.value = saved[i];
        });

        // Add extra rows if saved has more players
        for (let i = inputs.length; i < saved.length && i < 10; i++) {
            this.addPlayer();
            const newInputs = list.querySelectorAll('.player-name-input');
            newInputs[i].value = saved[i];
        }
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

        // Remember player names for next session
        try {
            localStorage.setItem('plongster-player-names', JSON.stringify(names));
        } catch (e) {}

        window.Game.init(names, this.winCount);
        this.showScreen('screen-game');
        window.Game.showPassPhone();
    },

    quickStart() {
        const savedNames = this._getSavedPlayerNames();
        const names = savedNames.length >= 2 ? savedNames.slice(0, 2) : ['Spiller 1', 'Spiller 2'];

        if (getSongs().length === 0) {
            alert('Ingen sanger lastet!');
            return;
        }

        try {
            localStorage.setItem('plongster-player-names', JSON.stringify(names));
        } catch (e) {}

        window.Game.init(names, this.winCount);
        this.showScreen('screen-game');
        window.Game.showPassPhone();
    },

    _getSavedPlayerNames() {
        try {
            const data = localStorage.getItem('plongster-player-names');
            if (!data) return [];
            const names = JSON.parse(data);
            if (Array.isArray(names) && names.every(n => typeof n === 'string' && n.length > 0)) {
                return names;
            }
        } catch (e) {}
        return [];
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
