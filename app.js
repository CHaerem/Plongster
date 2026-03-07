// Full database backup (never modified)
const ALL_SONGS = [...SONGS_DATABASE];

// Main application controller
const App = {
    winCount: 10,
    defaultSongCount: ALL_SONGS.length,
    _loadingAbort: null,
    _loadGeneration: 0,
    _anonToken: null,
    _anonTokenExpiry: 0,
    _selectedGenres: new Set(),    // Empty = all genres
    _usingCustomPlaylist: false,

    init() {
        // Sync winCount display from JS default
        document.getElementById('win-count').textContent = this.winCount;

        // Restore playlist URL into input
        const savedUrl = localStorage.getItem('hitster-playlist-url');
        const playlistInput = document.getElementById('playlist-url');
        if (savedUrl && playlistInput) playlistInput.value = savedUrl;

        // Restore cached playlist songs (instant, no network needed)
        const cachedSongs = localStorage.getItem('hitster-playlist-songs');
        const cachedName = localStorage.getItem('hitster-playlist-name');
        if (cachedSongs) {
            try {
                const songs = JSON.parse(cachedSongs);
                if (songs.length > 0) {
                    SONGS_DATABASE = songs;
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
            // Restore saved genre preferences
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

        // Render genre chips
        this.renderGenreChips();

        // Enter key support on setup screen: move to next input or start game
        document.getElementById('player-list').addEventListener('keydown', (e) => {
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
        if (Game.restoreState()) {
            this.showScreen('screen-game');
            Game.renderScores();
            if (Game.currentSong) {
                const cp = Game.challengePhase;
                if (cp && cp.challengerIndex !== null && cp.challengerDropIndex === null) {
                    // Mid-challenger placement: show challenger's timeline
                    Game.renderCurrentTurn();
                    Game.showChallengerTimeline();
                } else if (cp && cp.challengerDropIndex !== null) {
                    // Challenge resolved but reveal not shown — resolve again
                    Game.renderCurrentTurn();
                    Game.renderTimeline();
                    Game.resolvePlacement();
                } else if (cp && cp.challengerIndex === null && cp.originalDropIndex !== null) {
                    // Pre-reveal state (placement confirmed, not yet resolved)
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

    // =============================================
    // Spotify Playlist Loading
    // Strategy: Fast path (Web API) → Fallback (embed scraping)
    // =============================================

    async loadPlaylist() {
        const input = document.getElementById('playlist-url');
        const url = input.value.trim();

        if (!url) {
            this.resetSongs();
            return;
        }

        const playlistId = this._extractPlaylistId(url);
        if (!playlistId) {
            this._showSongStatus('Ugyldig Spotify-URL. Lim inn en spilleliste-lenke.', 'error');
            return;
        }

        // Cancel any in-progress load
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

            // Step 1: Get anonymous token (1 CORS proxy request)
            const token = await this._getAnonymousToken(signal);
            if (signal.aborted) return;

            // Step 2: Try Spotify Web API first (fast path — direct, no proxy)
            let songs = null;
            let playlistName = 'Spilleliste';

            try {
                this._showSongStatus('Henter sanger fra Spotify...', 'loading');
                const apiResult = await this._fetchViaWebAPI(playlistId, token, signal);
                songs = apiResult.songs;
                playlistName = apiResult.name;
            } catch (apiErr) {
                if (apiErr.name === 'AbortError') throw apiErr;
                console.warn('Web API failed, falling back to embed scraping:', apiErr.message);
            }

            // Step 3: Fallback — scrape embed pages (slower but works when API fails)
            if (!songs || songs.length === 0) {
                this._showSongStatus('Henter spilleliste...', 'loading');
                const embedResult = await this._fetchViaEmbedScraping(playlistId, signal, (done, total) => {
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

            // Deduplicate
            const seen = new Set();
            const unique = songs.filter(s => {
                const key = `${s.title.toLowerCase()}-${s.artist.toLowerCase()}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            // Replace database and cache
            SONGS_DATABASE = unique;
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
            // Only re-enable button if this is still the active load
            if (generation === this._loadGeneration) {
                if (loadBtn) loadBtn.disabled = false;
                this._loadingAbort = null;
            }
        }
    },

    // =============================================
    // Fast Path: Spotify Web API (direct, CORS-supported)
    // =============================================

    async _fetchViaWebAPI(playlistId, token, signal) {
        if (!token) throw new Error('No token');

        const songs = [];
        let playlistName = 'Spilleliste';

        // Fetch playlist name (with timeout, re-throw AbortError)
        try {
            const nameResp = await fetch(
                `https://api.spotify.com/v1/playlists/${playlistId}?fields=name`,
                { headers: { 'Authorization': `Bearer ${token}` }, signal }
            );
            if (nameResp.ok) {
                const nameData = await nameResp.json();
                playlistName = nameData.name || playlistName;
            }
        } catch (e) {
            if (e.name === 'AbortError') throw e;
        }

        // Fetch tracks with pagination
        let apiUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=items(track(id,name,artists(name),album(release_date))),next,total`;
        let pages = 0;
        const MAX_PAGES = 10; // Safety limit: 1000 tracks max

        while (apiUrl && pages < MAX_PAGES) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            pages++;

            const response = await fetch(apiUrl, {
                headers: { 'Authorization': `Bearer ${token}` },
                signal,
            });

            if (response.status === 429 || response.status === 401 || response.status === 403) {
                throw new Error(`API ${response.status}`);
            }
            if (!response.ok) {
                throw new Error(`Fant ikke spillelisten (${response.status}).`);
            }

            const data = await response.json();

            for (const item of (data.items || [])) {
                const track = item?.track;
                if (!track || !track.id) continue;

                const releaseDate = track.album?.release_date || '';
                const year = parseInt(releaseDate.substring(0, 4));
                if (!year || isNaN(year)) continue;

                songs.push({
                    title: track.name,
                    artist: track.artists.map(a => a.name).join(' & '),
                    year: year,
                    spotifyId: track.id,
                });
            }

            apiUrl = data.next;
        }

        return { songs, name: playlistName };
    },

    // =============================================
    // Fallback: Embed Page Scraping (via CORS proxy)
    // =============================================

    async _fetchViaEmbedScraping(playlistId, signal, onProgress) {
        // Step 1: Fetch playlist embed page → track list + name
        const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
        const html = await this._fetchViaCorsProxy(embedUrl, signal);

        const match = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (!match) throw new Error('Kunne ikke lese spillelistedata fra Spotify.');

        let nextData;
        try {
            nextData = JSON.parse(match[1]);
        } catch (e) {
            throw new Error('Kunne ikke tolke data fra Spotify.');
        }

        const entity = nextData?.props?.pageProps?.state?.data?.entity;

        if (!entity?.trackList || entity.trackList.length === 0) {
            throw new Error('Spillelisten er tom eller utilgjengelig.');
        }

        const trackList = entity.trackList
            .map(t => {
                const idMatch = t.uri?.match(/spotify:track:([a-zA-Z0-9]+)/);
                return { title: t.title, artist: t.subtitle, spotifyId: idMatch?.[1] };
            })
            .filter(t => t.spotifyId && t.title && /^[a-zA-Z0-9]{10,30}$/.test(t.spotifyId));

        const playlistName = entity.name || entity.title;

        // Step 2: Fetch release dates from individual track embed pages
        // Limit to 200 tracks max to avoid overwhelming CORS proxies
        const MAX_TRACKS = 200;
        const tracksToFetch = trackList.slice(0, MAX_TRACKS);
        if (trackList.length > MAX_TRACKS) {
            console.warn(`Playlist has ${trackList.length} tracks, limiting to ${MAX_TRACKS}`);
        }

        const BATCH_SIZE = 5;
        const BATCH_DELAY = 300;
        const songs = [];
        let completed = 0;
        const failed = [];

        for (let i = 0; i < tracksToFetch.length; i += BATCH_SIZE) {
            if (signal.aborted) return { songs, name: playlistName };

            const batch = tracksToFetch.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(
                batch.map(track => this._fetchTrackReleaseDate(track, signal))
            );

            for (let j = 0; j < results.length; j++) {
                completed++;
                if (results[j].status === 'fulfilled' && results[j].value) {
                    songs.push(results[j].value);
                } else {
                    failed.push(batch[j]);
                }
            }

            if (onProgress) onProgress(completed, tracksToFetch.length);

            if (i + BATCH_SIZE < tracksToFetch.length && !signal.aborted) {
                await new Promise(r => setTimeout(r, BATCH_DELAY));
            }
        }

        // Retry failed tracks once (with longer delay)
        if (failed.length > 0 && failed.length <= 30 && !signal.aborted) {
            await new Promise(r => setTimeout(r, 1000));
            for (let i = 0; i < failed.length; i += BATCH_SIZE) {
                if (signal.aborted) break;
                const batch = failed.slice(i, i + BATCH_SIZE);
                const results = await Promise.allSettled(
                    batch.map(track => this._fetchTrackReleaseDate(track, signal))
                );
                for (const r of results) {
                    if (r.status === 'fulfilled' && r.value) songs.push(r.value);
                }
                if (i + BATCH_SIZE < failed.length) {
                    await new Promise(r => setTimeout(r, 500));
                }
            }
        }

        return { songs, name: playlistName };
    },

    async _fetchTrackReleaseDate(track, signal) {
        const embedUrl = `https://open.spotify.com/embed/track/${track.spotifyId}`;
        const html = await this._fetchViaCorsProxy(embedUrl, signal, 8000);

        const dateMatch = html.match(/"releaseDate":\{"isoString":"([^"]+)"\}/);
        if (!dateMatch) return null;

        const year = new Date(dateMatch[1]).getFullYear();
        if (!year || isNaN(year)) return null;

        return {
            title: track.title,
            artist: track.artist,
            year: year,
            spotifyId: track.spotifyId,
        };
    },

    // =============================================
    // Anonymous Token (from Spotify embed page)
    // =============================================

    async _getAnonymousToken(signal) {
        if (this._anonToken && this._anonTokenExpiry > Date.now()) {
            return this._anonToken;
        }

        const embedUrl = 'https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT';

        try {
            const html = await this._fetchViaCorsProxy(embedUrl, signal, 12000);

            const match = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
            if (!match) return null;

            let nextData;
            try { nextData = JSON.parse(match[1]); } catch (e) { return null; }

            const token = this._findToken(nextData);
            if (!token) return null;

            this._anonToken = token;
            this._anonTokenExpiry = Date.now() + 50 * 60 * 1000;
            return token;
        } catch (e) {
            if (e.name === 'AbortError') throw e;
            console.warn('Token extraction failed:', e.message);
            return null;
        }
    },

    _findToken(data) {
        try {
            const paths = [
                data?.props?.pageProps?.state?.session?.accessToken,
                data?.props?.pageProps?.state?.settings?.session?.accessToken,
                data?.props?.pageProps?.accessToken,
            ];
            for (const t of paths) {
                if (t && typeof t === 'string' && t.length > 20) return t;
            }
        } catch (e) {}

        // Fallback: regex on stringified data (only runs if known paths fail)
        try {
            const json = JSON.stringify(data);
            const tokenMatch = json.match(/"accessToken"\s*:\s*"(BQ[A-Za-z0-9_-]{50,})"/);
            if (tokenMatch) return tokenMatch[1];
        } catch (e) {}

        return null;
    },

    // =============================================
    // CORS Proxy Layer
    // =============================================

    _corsProxies: [
        { fn: url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, json: false },
        { fn: url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, json: false },
        { fn: url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, json: true },
    ],
    _workingProxyIndex: 0,

    async _fetchViaCorsProxy(url, signal, timeoutMs = 12000) {
        const errors = [];

        // Try working proxy first, then others
        const indices = [this._workingProxyIndex];
        for (let i = 0; i < this._corsProxies.length; i++) {
            if (i !== this._workingProxyIndex) indices.push(i);
        }

        for (const idx of indices) {
            if (idx >= this._corsProxies.length) continue;
            const proxy = this._corsProxies[idx];
            const proxyUrl = proxy.fn(url);

            // Per-request timeout via AbortController
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);

            // Forward parent abort signal
            let onParentAbort;
            if (signal) {
                if (signal.aborted) {
                    clearTimeout(timeout);
                    throw new DOMException('Aborted', 'AbortError');
                }
                onParentAbort = () => controller.abort();
                signal.addEventListener('abort', onParentAbort, { once: true });
            }

            try {
                const response = await fetch(proxyUrl, { signal: controller.signal });

                if (!response.ok) {
                    errors.push(`P${idx}:${response.status}`);
                    continue;
                }

                let html;
                if (proxy.json) {
                    const wrapper = await response.json();
                    html = wrapper.contents;
                } else {
                    html = await response.text();
                }

                if (!html || html.length < 100) {
                    errors.push(`P${idx}:empty`);
                    continue;
                }

                this._workingProxyIndex = idx;
                return html;

            } catch (e) {
                if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
                errors.push(`P${idx}:${e.name === 'AbortError' ? 'timeout' : e.message}`);
                continue;
            } finally {
                // Always clean up timeout and parent listener
                clearTimeout(timeout);
                if (signal && onParentAbort) {
                    signal.removeEventListener('abort', onParentAbort);
                }
            }
        }

        throw new Error(`Proxy feilet (${errors.join(', ')})`);
    },

    // =============================================
    // Helpers
    // =============================================

    _extractPlaylistId(input) {
        if (!input) return null;
        // Match Spotify URLs: open.spotify.com/playlist/ID or spotify:playlist:ID
        const urlMatch = input.match(/(?:spotify\.com\/playlist\/|spotify:playlist:)([a-zA-Z0-9]+)/);
        if (urlMatch) return urlMatch[1];
        // Accept bare playlist IDs (22 chars typical)
        if (/^[a-zA-Z0-9]{15,25}$/.test(input.trim())) return input.trim();
        return null;
    },

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
        // Clear any in-progress game since song database is changing
        Game.clearState();
        this._usingCustomPlaylist = false;
        SONGS_DATABASE = [...ALL_SONGS];
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
            const count = SONGS_DATABASE.length;
            badge.textContent = `${count} sanger`;
            badge.className = 'song-source-badge';
        }
    },

    // --- Genre Filtering ---

    _genreConfig: [
        { id: 'pop', label: 'Pop', icon: '🎤' },
        { id: 'rock', label: 'Rock', icon: '🎸' },
        { id: 'hiphop', label: 'Hip-Hop', icon: '🎧' },
        { id: 'electronic', label: 'Elektronisk', icon: '🎹' },
        { id: 'norsk', label: 'Norsk', icon: '🇳🇴' },
    ],

    renderGenreChips() {
        const container = document.getElementById('genre-chips');
        if (!container) return;

        // Hide chips when using a custom playlist
        if (this._usingCustomPlaylist) {
            container.style.display = 'none';
            return;
        }

        // Check which genres actually exist in the database
        const availableGenres = new Set();
        ALL_SONGS.forEach(s => { if (s.genre) availableGenres.add(s.genre); });

        // If no songs have genres, hide the chips
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

        // Save preference
        localStorage.setItem('hitster-genres', JSON.stringify([...this._selectedGenres]));
    },

    applyGenreFilter() {
        if (this._usingCustomPlaylist) return; // Don't filter custom playlists

        if (this._selectedGenres.size === 0) {
            // No filter = all songs
            SONGS_DATABASE = [...ALL_SONGS];
        } else {
            SONGS_DATABASE = ALL_SONGS.filter(s => this._selectedGenres.has(s.genre));
        }
        // Clear any in-progress game since song database changed
        Game.clearState();
        this.updateSongBadge();
    },

    // --- Screen Management ---

    showScreen(screenId) {
        // Clean up any active overlays/panels from previous screen
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

        if (SONGS_DATABASE.length === 0) {
            alert('Ingen sanger lastet! Bruk standard sangliste eller last inn en spilleliste.');
            return;
        }

        const minSongs = names.length + this.winCount;
        if (SONGS_DATABASE.length < minSongs) {
            alert(`Trenger minst ${minSongs} sanger for ${names.length} spillere med ${this.winCount} kort. Har bare ${SONGS_DATABASE.length}.`);
            return;
        }

        Game.init(names, this.winCount);
        this.showScreen('screen-game');
        Game.showPassPhone();
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
        Game.stopPlayback();
        Game.clearState();
        this.showScreen('screen-setup');
    },
};

// Scripts are at end of body so DOM is ready - init immediately
App.init();
