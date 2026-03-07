// Game state and logic
const Game = {
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

    // Initialize a new game
    init(playerNames, cardsToWin) {
        this.cardsToWin = cardsToWin;
        this.currentPlayerIndex = 0;
        this.usedSongs = new Set();
        this.deck = shuffleArray(SONGS_DATABASE);
        this.currentSong = null;
        this.isWaitingForPlacement = false;
        this.selectedDropIndex = null;
        this._isPlaying = false;
        this._apiRetryCount = 0;

        // Each player starts with 1 card in their timeline
        this.players = playerNames.map(name => {
            const startCard = this.drawSong();
            return {
                name,
                timeline: [{ title: startCard.title, artist: startCard.artist, year: startCard.year }],
                score: 1,
            };
        });

        this.saveState();
    },

    get currentPlayer() {
        return this.players[this.currentPlayerIndex];
    },

    // Draw next song from deck (case-insensitive dedup, consistent with app.js)
    _songKey(song) {
        return `${song.title.toLowerCase()}-${song.artist.toLowerCase()}`;
    },

    drawSong() {
        while (this.deck.length > 0) {
            const song = this.deck.pop();
            const key = this._songKey(song);
            if (!this.usedSongs.has(key)) {
                this.usedSongs.add(key);
                return song;
            }
        }
        // Reshuffle if needed
        this.deck = shuffleArray(SONGS_DATABASE.filter(s => !this.usedSongs.has(this._songKey(s))));
        if (this.deck.length === 0) {
            this.usedSongs.clear();
            this.deck = shuffleArray(SONGS_DATABASE);
        }
        const song = this.deck.pop();
        // Guard against empty SONGS_DATABASE
        if (!song) return { title: 'Ukjent', artist: 'Ukjent', year: 2000, spotifyId: null };
        return song;
    },

    // =============================================
    // Spotify Playback
    // =============================================

    _loadGeneration: 0,
    _loadTimeout: null,

    // Validate spotifyId to prevent XSS (only alphanumeric)
    _isValidSpotifyId(id) {
        return typeof id === 'string' && /^[a-zA-Z0-9]{10,30}$/.test(id);
    },

    loadSong(spotifyId) {
        // Validate spotifyId before using in any HTML/URL context
        if (!this._isValidSpotifyId(spotifyId)) {
            console.warn('Invalid spotifyId, skipping load:', spotifyId);
            return;
        }

        // Increment generation to invalidate any stale callbacks
        this._loadGeneration++;
        const gen = this._loadGeneration;
        this._isPlaying = false;

        // Clear any pending retry timeout
        if (this._loadTimeout) {
            clearTimeout(this._loadTimeout);
            this._loadTimeout = null;
        }

        // Reset playback UI
        this._updatePlaybackUI('loading');

        if (!this.spotifyAPI) {
            // API might still be loading (e.g., page refresh) — retry a few times
            if (!this._apiRetryCount) this._apiRetryCount = 0;
            if (this._apiRetryCount < 5) {
                this._apiRetryCount++;
                this._loadTimeout = setTimeout(() => {
                    if (gen !== this._loadGeneration) return;
                    this.loadSong(spotifyId);
                }, 800);
                return;
            }
            // After retries, API genuinely unavailable (adblock, network error)
            this._apiRetryCount = 0;
            this.stopPlayback();
            this._updatePlaybackUI('error');
            return;
        }
        this._apiRetryCount = 0;

        const uri = `spotify:track:${spotifyId}`;

        // Strategy 1: Reuse existing controller with loadUri (fast, avoids flaky creation)
        if (this.embedController) {
            try {
                this.embedController.loadUri(uri);
                // Don't add listeners again — existing listeners check this._loadGeneration

                // Short timeout — loadUri on existing controller should be fast
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

        // Strategy 2: Create fresh controller (with retry logic)
        this.stopPlayback();
        this._createSpotifyController(spotifyId, gen, 0);
    },

    // Listeners added ONLY when creating a new controller (prevents accumulation)
    _setupListeners(controller) {
        controller.addListener('ready', () => {
            if (this._loadTimeout) {
                clearTimeout(this._loadTimeout);
                this._loadTimeout = null;
            }
            this._updatePlaybackUI('ready');
        });

        controller.addListener('playback_update', (e) => {
            if (!e.data) return;

            if (!e.data.isPaused && !e.data.isBuffering) {
                // Audio is actually playing
                this._isPlaying = true;
                if (this._loadTimeout) {
                    clearTimeout(this._loadTimeout);
                    this._loadTimeout = null;
                }
                this._updatePlaybackUI('playing');
                if (!this.hasPlayedSong) {
                    this.hasPlayedSong = true;
                    this.renderTimeline();
                }
            } else if (e.data.isPaused) {
                // Detect track end (position resets to 0 while we thought we were playing)
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

    // Create fresh Spotify controller with timeout and retry logic
    _createSpotifyController(spotifyId, gen, attempt) {
        if (gen !== this._loadGeneration) return;

        const uri = `spotify:track:${spotifyId}`;
        const container = document.getElementById('spotify-embed');
        container.innerHTML = '<div id="spotify-iframe"></div>';
        const iframeEl = document.getElementById('spotify-iframe');

        // Show retry feedback to user
        if (attempt > 0) {
            document.querySelector('.listening-text').textContent = 'Prøver igjen...';
        }

        // Timeout: if 'ready' doesn't fire, retry or fall back
        this._loadTimeout = setTimeout(() => {
            if (gen !== this._loadGeneration) return;

            if (attempt < 2) {
                console.warn(`Spotify embed timeout (attempt ${attempt + 1}), retrying...`);
                this.embedController = null;
                container.innerHTML = '';
                this._createSpotifyController(spotifyId, gen, attempt + 1);
            } else {
                // Max retries — enable button so user isn't stuck
                console.warn('Spotify embed timeout after retries');
                this._updatePlaybackUI('ready');
                document.querySelector('.listening-text').textContent = 'Trykk for å prøve igjen';
            }
        }, 4000);

        try {
            this.spotifyAPI.createController(
                iframeEl,
                { uri, height: 152, width: '100%', theme: 0 },
                (controller) => {
                    if (gen !== this._loadGeneration) return;
                    this.embedController = controller;
                    this._setupListeners(controller);
                }
            );
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

    // Centralized playback UI state manager
    _updatePlaybackUI(state) {
        const playPauseBtn = document.getElementById('btn-play-pause');
        const replayBtn = document.getElementById('btn-replay');
        const bars = document.getElementById('listening-bars');
        const text = document.querySelector('.listening-text');
        const controls = document.getElementById('playback-controls');

        if (!playPauseBtn || !bars || !text || !controls) return;

        // Play/pause icon SVGs
        const playIcon = '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
        const pauseIcon = '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>';

        switch (state) {
            case 'loading':
                playPauseBtn.innerHTML = playIcon;
                playPauseBtn.disabled = true;
                playPauseBtn.style.opacity = '0.4';
                if (replayBtn) { replayBtn.disabled = true; replayBtn.style.opacity = '0.4'; }
                bars.style.display = 'none';
                controls.style.display = 'flex';
                text.textContent = 'Laster sang...';
                break;

            case 'ready':
                playPauseBtn.innerHTML = playIcon;
                playPauseBtn.disabled = false;
                playPauseBtn.style.opacity = '';
                if (replayBtn) { replayBtn.disabled = false; replayBtn.style.opacity = ''; }
                bars.style.display = 'none';
                controls.style.display = 'flex';
                text.textContent = 'Trykk for å spille';
                break;

            case 'playing':
                playPauseBtn.innerHTML = pauseIcon;
                playPauseBtn.disabled = false;
                playPauseBtn.style.opacity = '';
                if (replayBtn) { replayBtn.disabled = false; replayBtn.style.opacity = ''; }
                bars.style.display = 'flex';
                controls.style.display = 'flex';
                text.textContent = 'Lytt og plasser sangen i tidslinjen';
                break;

            case 'paused':
                playPauseBtn.innerHTML = playIcon;
                playPauseBtn.disabled = false;
                playPauseBtn.style.opacity = '';
                if (replayBtn) { replayBtn.disabled = false; replayBtn.style.opacity = ''; }
                bars.style.display = 'none';
                controls.style.display = 'flex';
                text.textContent = 'Trykk for å spille';
                break;

            case 'error':
                playPauseBtn.innerHTML = playIcon;
                playPauseBtn.disabled = true;
                playPauseBtn.style.opacity = '0.4';
                if (replayBtn) { replayBtn.disabled = true; replayBtn.style.opacity = '0.4'; }
                bars.style.display = 'none';
                controls.style.display = 'flex';
                text.textContent = 'Spotify kunne ikke lastes. Sjekk at adblocker ikke blokkerer.';
                break;
        }
    },

    // Pause playback only if currently playing (safe — won't resume)
    pausePlayback() {
        if (this._loadTimeout) {
            clearTimeout(this._loadTimeout);
            this._loadTimeout = null;
        }
        if (this.embedController && this._isPlaying) {
            try { this.embedController.togglePlay(); } catch (e) {}
            this._isPlaying = false;
        }
    },

    // Stop playback and destroy the embed completely
    stopPlayback() {
        if (this._loadTimeout) {
            clearTimeout(this._loadTimeout);
            this._loadTimeout = null;
        }
        if (this.embedController) {
            if (this._isPlaying) {
                try { this.embedController.togglePlay(); } catch (e) {}
            }
            this.embedController = null;
        }
        this._isPlaying = false;
        const container = document.getElementById('spotify-embed');
        if (container) container.innerHTML = '';
    },

    // Called from play/pause button (direct user gesture = reliable)
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
        // Show immediate feedback while waiting for playback_update
        document.querySelector('.listening-text').textContent = 'Starter avspilling...';
    },

    // Skip current song (e.g., if it won't play or is region-restricted)
    skipSong() {
        this.pausePlayback();
        this.currentSong = this.drawSong();
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

    // Replay song from beginning
    replayFromStart() {
        if (this.currentSong && this._isValidSpotifyId(this.currentSong.spotifyId)) {
            this.loadSong(this.currentSong.spotifyId);
        }
    },

    // =============================================
    // Turn Management
    // =============================================

    startTurn(resumeSong) {
        if (resumeSong) {
            this.currentSong = resumeSong;
        } else {
            this.currentSong = this.drawSong();
        }
        this.isWaitingForPlacement = true;
        this.selectedDropIndex = null;
        this.hasPlayedSong = false;
        this._isPlaying = false;

        this.saveState();

        // Update UI
        this.renderScores();
        this.renderCurrentTurn();
        this.renderTimeline();

        // Hide embed and show listening cover, then load + autoplay
        const wrapper = document.querySelector('.spotify-player-wrapper');
        wrapper.classList.add('hidden-player');
        if (this.currentSong && this._isValidSpotifyId(this.currentSong.spotifyId)) {
            this.loadSong(this.currentSong.spotifyId);
        } else {
            // Song has no valid spotifyId — show error
            this._updatePlaybackUI('error');
            document.querySelector('.listening-text').textContent = 'Sangen har ingen avspillings-ID.';
            // Still allow placement (drop zones will show but no music)
            this.hasPlayedSong = true;
            this.renderTimeline();
        }
    },

    // Check if placement is correct
    isPlacementCorrect(timeline, song, index) {
        const year = song.year;
        if (index > 0 && timeline[index - 1].year > year) return false;
        if (index < timeline.length && timeline[index].year < year) return false;
        return true;
    },

    // Place song at index
    async placeSong(dropIndex) {
        if (!this.isWaitingForPlacement || !this.currentSong) return;
        if (dropIndex < 0 || dropIndex > this.currentPlayer.timeline.length) return;
        this.isWaitingForPlacement = false;
        // Pause playback but keep controller alive for reuse next turn
        this.pausePlayback();

        const player = this.currentPlayer;
        const correct = this.isPlacementCorrect(player.timeline, this.currentSong, dropIndex);

        if (correct) {
            player.timeline.splice(dropIndex, 0, {
                title: this.currentSong.title,
                artist: this.currentSong.artist,
                year: this.currentSong.year,
            });
            player.score = player.timeline.length;
        }

        this.saveState();
        this.showReveal(correct);
    },

    showReveal(correct) {
        const overlay = document.getElementById('song-reveal-overlay');
        const icon = document.getElementById('reveal-result-icon');
        const title = document.getElementById('reveal-title');
        const name = document.getElementById('reveal-song-name');
        const artist = document.getElementById('reveal-song-artist');
        const year = document.getElementById('reveal-song-year');

        icon.className = 'reveal-icon ' + (correct ? 'correct' : 'wrong');
        title.textContent = correct ? 'Riktig!' : 'Feil!';
        name.textContent = this.currentSong.title;
        artist.textContent = this.currentSong.artist;
        year.textContent = this.currentSong.year;

        // Haptic feedback on mobile
        if ('vibrate' in navigator) {
            navigator.vibrate(correct ? [50] : [100, 50, 100]);
        }

        overlay.classList.add('active');
    },

    nextTurn() {
        this.currentSong = null;
        const overlay = document.getElementById('song-reveal-overlay');
        overlay.classList.remove('active');

        const winner = this.players.find(p => p.score >= this.cardsToWin);
        if (winner) {
            this.showWinner(winner);
            return;
        }

        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
        this.saveState();
        this.showPassPhone();
    },

    showPassPhone() {
        const passOverlay = document.getElementById('pass-phone-overlay');
        document.getElementById('pass-phone-name').textContent = this.currentPlayer.name;
        passOverlay.classList.add('active');
    },

    onPlayerReady() {
        document.getElementById('pass-phone-overlay').classList.remove('active');
        this.startTurn();
    },

    showWinner(winner) {
        this.stopPlayback();
        this.clearState();
        document.getElementById('winner-name').textContent = winner.name;

        const scoresEl = document.getElementById('final-scores');
        const sorted = [...this.players].sort((a, b) => b.score - a.score);
        scoresEl.innerHTML = sorted.map(p => `
            <div class="final-score-row ${p === winner ? 'winner' : ''}">
                <span class="final-score-name">${this.escapeHtml(p.name)}</span>
                <span class="final-score-count">${p.score} kort</span>
            </div>
        `).join('');

        App.showScreen('screen-winner');
    },

    // =============================================
    // Rendering
    // =============================================

    renderScores() {
        const el = document.getElementById('game-scores');
        el.innerHTML = this.players.map((p, i) => `
            <div class="score-chip ${i === this.currentPlayerIndex ? 'active' : ''}">
                ${this.escapeHtml(p.name)}: ${p.score}
            </div>
        `).join('');
    },

    renderCurrentTurn() {
        const el = document.getElementById('current-turn');
        el.innerHTML = `<strong>${this.escapeHtml(this.currentPlayer.name)}</strong> sin tur`;
    },

    renderTimeline() {
        const el = document.getElementById('timeline');
        const player = this.currentPlayer;
        const timeline = player.timeline;

        let html = '';

        const showDropZones = this.isWaitingForPlacement && this.hasPlayedSong;

        if (showDropZones) {
            html += this.renderDropZone(0, timeline.length === 0 ? 'Plasser her' : 'Eldst');
        }

        for (let i = 0; i < timeline.length; i++) {
            const card = timeline[i];
            html += `
                <div class="timeline-card">
                    <span class="card-year">${card.year}</span>
                    <div class="card-info">
                        <div class="card-title">${this.escapeHtml(card.title)}</div>
                        <div class="card-artist">${this.escapeHtml(card.artist)}</div>
                    </div>
                </div>
            `;

            if (showDropZones) {
                const label = i === timeline.length - 1 ? 'Nyest' : '';
                html += this.renderDropZone(i + 1, label);
            }
        }

        if (timeline.length === 0 && !this.isWaitingForPlacement) {
            html = '<p style="text-align:center;color:var(--text-dim);padding:20px;">Tidslinjen er tom</p>';
        }

        el.innerHTML = html;
        el.classList.toggle('timeline-empty', timeline.length === 0 && !this.isWaitingForPlacement);

        document.getElementById('timeline-title').textContent =
            `${this.escapeHtml(this.currentPlayer.name)}s tidslinje (${timeline.length} kort)`;
    },

    renderDropZone(index, label = '') {
        return `
            <div class="drop-zone" onclick="Game.onDropZoneClick(${index})">
                <span>${label || 'Plasser her'}</span>
            </div>
        `;
    },

    onDropZoneClick(index) {
        if (!this.isWaitingForPlacement) return;
        if (this._dropDebounce) return;
        this._dropDebounce = true;
        setTimeout(() => { this._dropDebounce = false; }, 300);
        this.selectedDropIndex = index;
        this.showPlacementConfirmation(index);
    },

    showPlacementConfirmation(index) {
        const existing = document.querySelector('.confirm-placement');
        if (existing) existing.remove();

        const player = this.currentPlayer;
        const timeline = player.timeline;

        let positionText = '';
        if (timeline.length === 0) {
            positionText = 'Start tidslinjen med denne sangen?';
        } else if (index === 0) {
            positionText = `Plassere f\u00f8r ${timeline[0].year}?`;
        } else if (index === timeline.length) {
            positionText = `Plassere etter ${timeline[timeline.length - 1].year}?`;
        } else {
            positionText = `Plassere mellom ${timeline[index - 1].year} og ${timeline[index].year}?`;
        }

        const html = `
            <div class="confirm-placement slide-up">
                <p>${positionText}</p>
                <div class="confirm-buttons">
                    <button class="btn btn-secondary" onclick="Game.cancelPlacement()">Avbryt</button>
                    <button class="btn btn-success" onclick="Game.confirmPlacement()">Bekreft</button>
                </div>
            </div>
        `;

        document.getElementById('screen-game').insertAdjacentHTML('beforeend', html);

        document.querySelectorAll('.drop-zone').forEach((dz, i) => {
            dz.classList.toggle('highlight', i === index);
            if (i === index) {
                dz.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    },

    cancelPlacement() {
        const existing = document.querySelector('.confirm-placement');
        if (existing) existing.remove();
        this.selectedDropIndex = null;
        document.querySelectorAll('.drop-zone').forEach(dz => dz.classList.remove('highlight'));
    },

    confirmPlacement() {
        const existing = document.querySelector('.confirm-placement');
        if (existing) existing.remove();
        if (this.selectedDropIndex !== null && this.isWaitingForPlacement) {
            const idx = this.selectedDropIndex;
            this.selectedDropIndex = null; // Clear immediately to prevent double-fire
            this.placeSong(idx);
        }
    },

    // =============================================
    // State Persistence
    // =============================================

    saveState() {
        const state = {
            players: this.players,
            currentPlayerIndex: this.currentPlayerIndex,
            cardsToWin: this.cardsToWin,
            usedSongs: [...this.usedSongs],
            currentSong: this.currentSong,
        };
        try {
            localStorage.setItem('hitster-game', JSON.stringify(state));
        } catch (e) {
            console.warn('Could not save game state:', e.message);
        }
    },

    restoreState() {
        const data = localStorage.getItem('hitster-game');
        if (!data) return false;
        try {
            const state = JSON.parse(data);

            // Validate structure to prevent crashes from corrupt data
            if (!Array.isArray(state.players) || state.players.length < 2) return false;
            if (typeof state.currentPlayerIndex !== 'number') return false;
            if (state.currentPlayerIndex < 0 || state.currentPlayerIndex >= state.players.length) return false;
            if (typeof state.cardsToWin !== 'number' || state.cardsToWin < 1) return false;
            if (!state.players.every(p =>
                typeof p.name === 'string' && p.name.length > 0 &&
                Array.isArray(p.timeline) &&
                typeof p.score === 'number'
            )) return false;

            this.players = state.players;
            // Recalculate scores from timeline length to prevent desync
            this.players.forEach(p => { p.score = p.timeline.length; });
            this.currentPlayerIndex = state.currentPlayerIndex;
            this.cardsToWin = state.cardsToWin;
            this.usedSongs = new Set(Array.isArray(state.usedSongs) ? state.usedSongs : []);
            this.deck = shuffleArray(SONGS_DATABASE.filter(s => !this.usedSongs.has(this._songKey(s))));
            this.currentSong = state.currentSong || null;
            this.isWaitingForPlacement = false;
            this.selectedDropIndex = null;
            this._isPlaying = false;
            return true;
        } catch {
            // Corrupt data — clear it
            this.clearState();
            return false;
        }
    },

    clearState() {
        localStorage.removeItem('hitster-game');
    },

    // =============================================
    // Hamburger Menu (Game Master)
    // =============================================

    toggleMenu() {
        const panel = document.getElementById('gm-panel');
        const backdrop = document.getElementById('gm-backdrop');
        if (panel.classList.contains('active')) {
            this.closeMenu();
        } else {
            this.renderMenu();
            panel.classList.add('active');
            backdrop.classList.add('active');
        }
    },

    closeMenu() {
        document.getElementById('gm-panel').classList.remove('active');
        document.getElementById('gm-backdrop').classList.remove('active');
    },

    renderMenu() {
        const body = document.getElementById('gm-panel-body');
        let html = '';

        html += '<div class="gm-section"><h4>Spillere</h4>';
        this.players.forEach((player, i) => {
            html += `
                <div class="gm-player-row">
                    <div class="gm-player-order">
                        <button class="btn-icon btn-xs" onclick="Game.gmMovePlayer(${i}, -1)" ${i === 0 ? 'disabled' : ''}>▲</button>
                        <button class="btn-icon btn-xs" onclick="Game.gmMovePlayer(${i}, 1)" ${i === this.players.length - 1 ? 'disabled' : ''}>▼</button>
                    </div>
                    <span class="gm-player-name">${this.escapeHtml(player.name)}</span>
                    <div class="gm-player-actions">
                        <button class="btn-icon btn-sm" onclick="Game.gmAdjustScore(${i}, -1)">−</button>
                        <span class="gm-player-score">${player.score}</span>
                        <button class="btn-icon btn-sm" onclick="Game.gmAdjustScore(${i}, 1)">+</button>
                        ${this.players.length > 2 ? `<button class="btn-icon btn-sm gm-btn-remove" onclick="Game.gmRemovePlayer(${i})">&times;</button>` : ''}
                    </div>
                </div>`;
        });
        html += `
            <div class="gm-add-player-row">
                <input type="text" id="gm-new-player-name" placeholder="Ny spiller" maxlength="15">
                <button class="btn btn-secondary btn-sm" onclick="Game.gmAddPlayer()">+</button>
            </div>`;
        html += '</div>';

        html += '<div class="gm-section"><h4>Rediger tidslinje</h4>';
        html += '<select id="gm-timeline-player" onchange="Game.gmRenderTimeline()">';
        this.players.forEach((player, i) => {
            html += `<option value="${i}" ${i === this.currentPlayerIndex ? 'selected' : ''}>${this.escapeHtml(player.name)} (${player.timeline.length} kort)</option>`;
        });
        html += '</select>';
        html += '<div id="gm-timeline-cards"></div>';
        html += '</div>';

        html += `<div class="gm-section"><h4>Info</h4>
            <p class="gm-empty">${this.deck.length} sanger igjen i bunken</p>
        </div>`;

        html += `<div class="gm-section">
            <button class="btn btn-danger gm-btn-restart" onclick="Game.gmRestart()">Start på nytt</button>
        </div>`;

        body.innerHTML = html;
        this.gmRenderTimeline();
    },

    gmRenderTimeline() {
        const select = document.getElementById('gm-timeline-player');
        const playerIndex = parseInt(select.value);
        const player = this.players[playerIndex];
        const container = document.getElementById('gm-timeline-cards');

        if (player.timeline.length === 0) {
            container.innerHTML = '<p class="gm-empty">Ingen kort</p>';
            return;
        }

        container.innerHTML = player.timeline.map((card, ci) => `
            <div class="gm-card">
                <span class="gm-card-year">${card.year}</span>
                <span class="gm-card-title">${this.escapeHtml(card.title)}</span>
                <button class="gm-card-remove" onclick="Game.gmRemoveCard(${playerIndex}, ${ci})">&times;</button>
            </div>
        `).join('');
    },

    gmMovePlayer(playerIndex, direction) {
        const newIndex = playerIndex + direction;
        if (newIndex < 0 || newIndex >= this.players.length) return;

        [this.players[playerIndex], this.players[newIndex]] = [this.players[newIndex], this.players[playerIndex]];

        if (this.currentPlayerIndex === playerIndex) {
            this.currentPlayerIndex = newIndex;
        } else if (this.currentPlayerIndex === newIndex) {
            this.currentPlayerIndex = playerIndex;
        }

        this.saveState();
        this.renderScores();
        this.renderCurrentTurn();
        this.renderMenu();
    },

    gmAdjustScore(playerIndex, delta) {
        const player = this.players[playerIndex];
        if (delta > 0) {
            const card = this.drawSong();
            player.timeline.push({ title: card.title, artist: card.artist, year: card.year });
            player.timeline.sort((a, b) => a.year - b.year);
        } else if (delta < 0 && player.timeline.length > 0) {
            player.timeline.pop();
        }
        player.score = player.timeline.length;
        this.saveState();
        this.renderScores();
        this.renderTimeline();
        this.renderMenu();
    },

    gmRemoveCard(playerIndex, cardIndex) {
        const player = this.players[playerIndex];
        if (cardIndex < 0 || cardIndex >= player.timeline.length) return;
        player.timeline.splice(cardIndex, 1);
        player.score = player.timeline.length;
        this.saveState();
        this.renderScores();
        this.renderTimeline();
        this.gmRenderTimeline();
    },

    gmAddPlayer() {
        const input = document.getElementById('gm-new-player-name');
        const name = input.value.trim();
        if (!name || this.players.length >= 10) return;
        if (this.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
            alert('En spiller med dette navnet finnes allerede.');
            return;
        }

        const startCard = this.drawSong();
        this.players.push({
            name,
            timeline: [{ title: startCard.title, artist: startCard.artist, year: startCard.year }],
            score: 1,
        });

        this.saveState();
        this.renderScores();
        this.renderMenu();
    },

    gmRemovePlayer(playerIndex) {
        if (this.players.length <= 2) return;

        const wasCurrentPlayer = playerIndex === this.currentPlayerIndex;
        this.players.splice(playerIndex, 1);

        if (this.currentPlayerIndex >= this.players.length) {
            this.currentPlayerIndex = 0;
        } else if (playerIndex < this.currentPlayerIndex) {
            this.currentPlayerIndex--;
        }

        if (wasCurrentPlayer) {
            this.saveState();
            this.closeMenu();
            this.renderScores();
            this.showPassPhone();
            return;
        }

        this.saveState();
        this.renderScores();
        this.renderCurrentTurn();
        this.renderMenu();
    },

    gmRestart() {
        if (!confirm('Er du sikker på at du vil starte på nytt?')) return;
        this.stopPlayback();
        this.closeMenu();
        this.clearState();
        App.showScreen('screen-setup');
    },

    escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
};

// Keyboard shortcuts (M9: Escape to close overlays/panels)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        // Close game master panel if open
        if (document.getElementById('gm-panel').classList.contains('active')) {
            Game.closeMenu();
            return;
        }
        // Cancel placement confirmation if visible
        if (Game.selectedDropIndex !== null) {
            Game.cancelPlacement();
        }
    }
});

// Spotify IFrame API callback
window.onSpotifyIframeApiReady = (IFrameAPI) => {
    Game.spotifyAPI = IFrameAPI;
};
