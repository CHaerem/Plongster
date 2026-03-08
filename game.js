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
    challengePhase: null,   // { originalPlayerIndex, originalDropIndex, challengers[], currentChallengerIdx, winnerChallengerPlayerIndex }
    titleArtistClaimed: false,
    MAX_TOKENS: 5,

    // Initialize a new game
    init(playerNames, cardsToWin) {
        this.cardsToWin = cardsToWin;
        this.currentPlayerIndex = 0;
        this.usedSongs = new Set();
        // Snapshot the database at init time to prevent mid-game corruption
        this._gameDatabase = [...SONGS_DATABASE];
        this.deck = shuffleArray(this._gameDatabase);
        this.currentSong = null;
        this.isWaitingForPlacement = false;
        this.selectedDropIndex = null;
        this._isPlaying = false;
        this._apiRetryCount = 0;
        this.challengePhase = null;
        this.titleArtistClaimed = false;

        // Each player starts with 1 card in their timeline and 3 tokens
        this.players = playerNames.map(name => {
            const startCard = this.drawSong();
            if (!startCard) return { name, timeline: [], score: 0, tokens: 3 };
            return {
                name,
                timeline: [{ title: startCard.title, artist: startCard.artist, year: startCard.year }],
                score: 1,
                tokens: 3,
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
        // Try to find remaining unused songs (use snapshot if available, else global)
        const db = this._gameDatabase || SONGS_DATABASE;
        this.deck = shuffleArray(db.filter(s => !this.usedSongs.has(this._songKey(s))));
        if (this.deck.length > 0) {
            const song = this.deck.pop();
            this.usedSongs.add(this._songKey(song));
            return song;
        }
        // No songs left — end game, player with most cards wins
        this.endGameNoSongs();
        return null;
    },

    endGameNoSongs() {
        this.pausePlayback();
        const winner = [...this.players].sort((a, b) => b.score - a.score)[0];
        document.getElementById('winner-name').textContent = winner.name;
        const scoresEl = document.getElementById('final-scores');
        scoresEl.innerHTML = '<p style="margin-bottom:10px;color:var(--text-dim)">Alle sanger er brukt opp!</p>' +
            this.players.map(p =>
                `<div class="final-score-row"><span>${this.escapeHtml(p.name)}</span><span>${p.score} kort \u00B7 \u{1F536}${p.tokens}</span></div>`
            ).join('');
        localStorage.removeItem('hitster-game-state');
        App.showScreen('screen-winner');
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
                    this.renderGameActions();
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

        // Nullify old controller to prevent stale listener callbacks
        this.embedController = null;

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
        if (!this.currentSong) return; // Game ended — no songs left
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

    // Skip current song using a token (player action, costs 1 token)
    skipSongWithToken() {
        if (this._skipDebounce) return;
        this._skipDebounce = true;
        setTimeout(() => { this._skipDebounce = false; }, 500);

        const player = this.currentPlayer;
        if (player.tokens < 1) return;
        player.tokens -= 1;
        this.skipSong(); // Reuse existing skip logic
        this.renderScores();
        this.renderGameActions();
    },

    // Trade 3 tokens for a free card placed on timeline
    tradeTokensForCard() {
        if (this._tradeDebounce) return;
        this._tradeDebounce = true;
        setTimeout(() => { this._tradeDebounce = false; }, 500);

        const player = this.currentPlayer;
        if (player.tokens < 3) return;

        const card = this.drawSong();
        if (!card) return; // No songs left

        player.tokens -= 3;

        // Auto-place in correct chronological position
        let insertIdx = player.timeline.findIndex(c => c.year >= card.year);
        if (insertIdx === -1) insertIdx = player.timeline.length;
        player.timeline.splice(insertIdx, 0, {
            title: card.title, artist: card.artist, year: card.year,
        });
        player.score = player.timeline.length;

        this.saveState();
        this.renderScores();
        this.renderTimeline();
        this.renderGameActions();

        // Check for winner
        if (player.score >= this.cardsToWin) {
            this.showWinner(player);
        }
    },

    // Render token action buttons (skip / trade) during placement phase
    renderGameActions() {
        const el = document.getElementById('game-actions');
        if (!this.isWaitingForPlacement || !this.hasPlayedSong) {
            el.innerHTML = '';
            return;
        }
        const p = this.currentPlayer;
        let html = '';
        if (p.tokens >= 1) {
            html += `<button class="btn btn-ghost action-btn" onclick="Game.skipSongWithToken()">\u23ED Hopp over (1 \u{1F536})</button>`;
        }
        if (p.tokens >= 3) {
            html += `<button class="btn btn-ghost action-btn" onclick="Game.tradeTokensForCard()">\u{1F504} Bytt 3 \u{1F536} \u2192 1 kort</button>`;
        }
        el.innerHTML = html;
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
            if (!this.currentSong) return; // Game ended — no songs left
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
        this.renderGameActions();

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

    // Find the correct chronological position for a card in a timeline
    _findChronologicalIndex(timeline, year) {
        for (let i = 0; i < timeline.length; i++) {
            if (year <= timeline[i].year) return i;
        }
        return timeline.length;
    },

    showReveal(result) {
        // Close challenge overlay if open (after challenger flow)
        this._hideOverlay('challenge-overlay');

        // Make sure reveal overlay is open
        this._showOverlay('song-reveal-overlay');

        // Ensure edit form is hidden and song info is visible
        document.getElementById('edit-song-form').style.display = 'none';
        document.getElementById('reveal-song-info').style.display = '';

        // Switch from pre-reveal to result
        document.getElementById('pre-reveal').style.display = 'none';
        const resultSection = document.getElementById('reveal-result');
        resultSection.style.display = '';

        const icon = document.getElementById('reveal-result-icon');
        const title = document.getElementById('reveal-title');
        const subtitle = document.getElementById('reveal-subtitle');
        const name = document.getElementById('reveal-song-name');
        const artist = document.getElementById('reveal-song-artist');
        const year = document.getElementById('reveal-song-year');

        const isPositive = (result === 'no_challenge_correct' || result === 'original_wins');

        switch (result) {
            case 'no_challenge_correct':
                icon.className = 'reveal-icon correct';
                title.textContent = 'Riktig!';
                subtitle.textContent = '';
                subtitle.className = 'reveal-subtitle';
                break;
            case 'no_challenge_wrong':
                icon.className = 'reveal-icon wrong';
                title.textContent = 'Feil!';
                subtitle.textContent = '';
                subtitle.className = 'reveal-subtitle';
                break;
            case 'original_wins':
                icon.className = 'reveal-icon correct';
                title.textContent = 'Riktig!';
                subtitle.textContent = `${this.escapeHtml(this.players[this.challengePhase.originalPlayerIndex].name)} beholder kortet`;
                subtitle.className = 'reveal-subtitle';
                break;
            case 'challenger_wins':
                icon.className = 'reveal-icon stolen';
                title.textContent = 'Stjålet!';
                subtitle.textContent = `${this.escapeHtml(this.players[this.challengePhase.winnerChallengerPlayerIndex].name)} stjal kortet!`;
                subtitle.className = 'reveal-subtitle stolen';
                break;
            case 'nobody_wins':
                icon.className = 'reveal-icon wrong';
                title.textContent = 'Begge feil!';
                subtitle.textContent = 'Ingen får kortet';
                subtitle.className = 'reveal-subtitle';
                break;
            case 'nobody_wins_multi':
                icon.className = 'reveal-icon wrong';
                title.textContent = 'Alle feil!';
                subtitle.textContent = 'Ingen får kortet';
                subtitle.className = 'reveal-subtitle';
                break;
        }

        name.textContent = this.currentSong.title;
        artist.textContent = this.currentSong.artist;
        year.textContent = this.currentSong.year;

        // Haptic feedback on mobile
        if ('vibrate' in navigator) {
            navigator.vibrate(isPositive ? [50] : [100, 50, 100]);
        }

        // Token award for title/artist claim — ask for confirmation
        const tokenSection = document.getElementById('token-award-section');
        const tokenText = document.getElementById('token-award-text');
        const tokenButtons = document.getElementById('token-award-buttons');
        const nextTurnBtn = document.getElementById('btn-next-turn');
        if (this.titleArtistClaimed) {
            const claimPlayer = this.players[this.challengePhase.originalPlayerIndex];
            tokenText.textContent = `${this.escapeHtml(claimPlayer.name)} hevdet \u00e5 vite tittel og artist \u2014 stemte det?`;
            tokenText.className = 'token-award-text';
            tokenButtons.style.display = '';
            tokenSection.style.display = '';
            nextTurnBtn.style.display = 'none';
        } else {
            tokenSection.style.display = 'none';
            tokenButtons.style.display = 'none';
            nextTurnBtn.style.display = '';
        }

        this.saveState();
        this.renderScores();
    },

    nextTurn() {
        this.currentSong = null;
        this.challengePhase = null;
        this.titleArtistClaimed = false;
        this._challengerMode = false;
        this._lastPlacedCard = null;

        this._hideOverlay('song-reveal-overlay');

        // Reset reveal overlay sections for next time
        document.getElementById('pre-reveal').style.display = '';
        document.getElementById('reveal-result').style.display = 'none';

        // Hide token award section for next time
        const tokenSection = document.getElementById('token-award-section');
        if (tokenSection) tokenSection.style.display = 'none';

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
        document.getElementById('pass-phone-name').textContent = this.currentPlayer.name;
        this._showOverlay('pass-phone-overlay');
    },

    onPlayerReady() {
        this._hideOverlay('pass-phone-overlay');
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
                <span class="final-score-count">${p.score} kort \u00B7 \u{1F536}${p.tokens}</span>
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
                <span class="token-count"><span class="token-icon">\u{1F536}</span>${p.tokens}</span>
            </div>
        `).join('');
    },

    renderCurrentTurn() {
        const el = document.getElementById('current-turn');
        el.innerHTML = `<strong>${this.escapeHtml(this.currentPlayer.name)}</strong> sin tur`;
    },

    // Shared timeline renderer used by both normal and challenger flows
    // disabledDropIndices can be a Set of indices or a single number (backwards compat)
    _renderTimelineHTML(player, showDropZones, dropClickFn, disabledDropIndices) {
        const timeline = player.timeline;
        let html = '';
        // Normalize to Set
        const disabledSet = disabledDropIndices instanceof Set
            ? disabledDropIndices
            : (disabledDropIndices != null ? new Set([disabledDropIndices]) : new Set());

        if (showDropZones) {
            const isDisabled = disabledSet.has(0);
            const label = timeline.length === 0 ? 'Plasser her' : 'Eldst';
            if (isDisabled) {
                html += `<div class="drop-zone disabled"><span>\u{1F6AB} Opptatt</span></div>`;
            } else {
                html += `<div class="drop-zone" onclick="${dropClickFn}(0)"><span>${label}</span></div>`;
            }
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
                const dropIndex = i + 1;
                const isDisabled = disabledSet.has(dropIndex);
                const label = i === timeline.length - 1 ? 'Nyest' : '';
                if (isDisabled) {
                    html += `<div class="drop-zone disabled"><span>\u{1F6AB} Opptatt</span></div>`;
                } else {
                    html += `<div class="drop-zone" onclick="${dropClickFn}(${dropIndex})"><span>${label || 'Plasser her'}</span></div>`;
                }
            }
        }

        if (timeline.length === 0 && !showDropZones) {
            html = '<p style="text-align:center;color:var(--text-dim);padding:20px;">Tidslinjen er tom</p>';
        }

        return html;
    },

    renderTimeline() {
        const el = document.getElementById('timeline');
        const player = this.currentPlayer;
        const showDropZones = this.isWaitingForPlacement && this.hasPlayedSong;

        el.innerHTML = this._renderTimelineHTML(player, showDropZones, 'Game.onDropZoneClick');
        el.classList.toggle('timeline-empty', player.timeline.length === 0 && !this.isWaitingForPlacement);

        const titleEl = document.getElementById('timeline-title');
        titleEl.textContent = `${this.escapeHtml(player.name)}s tidslinje (${player.timeline.length} kort)`;
        titleEl.classList.remove('challenger');
    },

    onDropZoneClick(index) {
        if (!this.isWaitingForPlacement) return;
        if (this._dropDebounce) return;
        this._dropDebounce = true;
        setTimeout(() => { this._dropDebounce = false; }, 300);
        this.selectedDropIndex = index;
        this.showPlacementConfirmation(index);
    },

    // Shared placement confirmation dialog (used by both normal and challenger flow)
    _showPlacementDialog(index, timeline, cancelFn, confirmFn) {
        const existing = document.querySelector('.confirm-placement');
        if (existing) existing.remove();

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
                    <button class="btn btn-secondary" onclick="${cancelFn}">Avbryt</button>
                    <button class="btn btn-success" onclick="${confirmFn}">Bekreft</button>
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

    showPlacementConfirmation(index) {
        this._showPlacementDialog(index, this.currentPlayer.timeline, 'Game.cancelPlacement()', 'Game.confirmPlacement()');
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
            this.isWaitingForPlacement = false;
            this.pausePlayback();

            // Initialize challenge phase
            this.challengePhase = {
                originalPlayerIndex: this.currentPlayerIndex,
                originalDropIndex: idx,
                challengers: [],
                currentChallengerIdx: 0,
                winnerChallengerPlayerIndex: null,
            };
            this.saveState();
            this.showPreReveal();
        }
    },

    // =============================================
    // Challenge (Utfordring) Phase
    // =============================================

    // Show reveal overlay in "pre-reveal" mode (quick decision: reveal or challenge)
    showPreReveal() {
        const cp = this.challengePhase;
        const placedChallengers = cp.challengers.filter(c => c.dropIndex !== null).length;

        // Only reset claim on first pre-reveal (before any challenge has placed)
        if (placedChallengers === 0) {
            this.titleArtistClaimed = false;
        }

        document.getElementById('pre-reveal').style.display = '';
        document.getElementById('reveal-result').style.display = 'none';
        this._showOverlay('song-reveal-overlay');

        // Claim button: only show on first pre-reveal
        const claimBtn = document.getElementById('btn-claim-title');
        if (claimBtn) {
            if (placedChallengers > 0) {
                claimBtn.style.display = 'none';
            } else {
                claimBtn.style.display = '';
                claimBtn.classList.remove('active');
                const player = this.players[cp.originalPlayerIndex];
                if (player.tokens >= this.MAX_TOKENS) {
                    claimBtn.disabled = true;
                    claimBtn.textContent = '\uD83C\uDFA4 Maks tokens (' + this.MAX_TOKENS + ')';
                } else {
                    claimBtn.disabled = false;
                    claimBtn.textContent = '\uD83C\uDFA4 Jeg vet tittel og artist (+1 \u{1F536})';
                }
            }
        }

        // Challenge button: check eligible challengers (not original, not already in challengers[], has tokens)
        const challengeBtn = document.getElementById('btn-challenge');
        if (challengeBtn) {
            const alreadyChallenging = new Set(cp.challengers.map(c => c.playerIndex));
            const eligiblePlayers = this.players.filter((p, i) =>
                i !== cp.originalPlayerIndex && !alreadyChallenging.has(i) && p.tokens >= 1
            );

            // Also need available drop positions on the timeline
            const originalPlayer = this.players[cp.originalPlayerIndex];
            const totalDropZones = originalPlayer.timeline.length + 1;
            const usedPositions = new Set([cp.originalDropIndex]);
            cp.challengers.forEach(c => {
                if (c.dropIndex !== null) usedPositions.add(c.dropIndex);
            });
            const availablePositions = totalDropZones - usedPositions.size;

            challengeBtn.style.display = (eligiblePlayers.length > 0 && availablePositions > 0) ? '' : 'none';
        }

        // Clear game actions (skip/trade buttons)
        document.getElementById('game-actions').innerHTML = '';

        this.saveState();
    },

    // Toggle title/artist claim (player claims they know the song before reveal)
    toggleTitleClaim() {
        this.titleArtistClaimed = !this.titleArtistClaimed;
        const btn = document.getElementById('btn-claim-title');
        if (btn) {
            btn.classList.toggle('active', this.titleArtistClaimed);
        }
        this.saveState();
    },

    // Confirm or deny title/artist claim after reveal
    confirmTitleClaim(correct) {
        const tokenText = document.getElementById('token-award-text');
        const tokenButtons = document.getElementById('token-award-buttons');
        const claimPlayer = this.players[this.challengePhase.originalPlayerIndex];

        if (correct) {
            if (claimPlayer.tokens < this.MAX_TOKENS) {
                claimPlayer.tokens += 1;
                tokenText.textContent = `${this.escapeHtml(claimPlayer.name)} fikk +1 \u{1F536} for tittel og artist! (\u{1F536}${claimPlayer.tokens})`;
                tokenText.className = 'token-award-text earned';
            } else {
                tokenText.textContent = `Riktig! Men maks tokens (${this.MAX_TOKENS}) \u2014 ingen token tildelt`;
                tokenText.className = 'token-award-text';
            }
        } else {
            tokenText.textContent = `${this.escapeHtml(claimPlayer.name)} gjettet feil \u2014 ingen token`;
            tokenText.className = 'token-award-text';
        }
        tokenButtons.style.display = 'none';
        document.getElementById('btn-next-turn').style.display = '';
        this.saveState();
        this.renderScores();
    },

    // No challenge — go straight to resolve and show result
    skipChallenge() {
        this.resolvePlacement();
    },

    // Someone wants to challenge — open challenge overlay for player selection
    startChallenge() {
        const cp = this.challengePhase;
        // Eligible: has tokens, not original player, not already a challenger
        const alreadyChallenging = new Set(cp.challengers.map(c => c.playerIndex));
        const otherPlayers = [];
        this.players.forEach((p, i) => {
            if (i !== cp.originalPlayerIndex && !alreadyChallenging.has(i) && p.tokens >= 1) {
                otherPlayers.push({ player: p, index: i });
            }
        });

        if (otherPlayers.length === 0) return;

        const content = document.getElementById('challenge-content');

        if (otherPlayers.length === 1) {
            // Only one possible challenger — skip selection, go straight to pass phone
            const challenger = otherPlayers[0];
            if (challenger.player.tokens < 1) return;
            challenger.player.tokens = Math.max(0, challenger.player.tokens - 1);
            cp.challengers.push({ playerIndex: challenger.index, dropIndex: null });
            cp.currentChallengerIdx = cp.challengers.length - 1;
            this.saveState();
            this.renderScores();
            this._showPassPhoneForChallenger();
            return;
        }

        // Multiple possible challengers — show selection list
        let playerButtons = '';
        otherPlayers.forEach(({ player, index }) => {
            playerButtons += `<button class="challenge-player-btn" onclick="Game.selectChallenger(${index})">${this.escapeHtml(player.name)} (\u{1F536}${player.tokens})</button>`;
        });

        content.innerHTML = `
            <h2>Hvem utfordrer?</h2>
            <p class="challenge-text">Koster 1 \u{1F536} \u00e5 utfordre:</p>
            <div class="challenge-player-list">${playerButtons}</div>
            <button class="btn btn-ghost" onclick="Game.cancelChallenge()">Avbryt</button>
        `;
        this._showOverlay('challenge-overlay');
    },

    // Cancel challenge selection — close overlay, stay on pre-reveal
    cancelChallenge() {
        this._hideOverlay('challenge-overlay');
        this.saveState();
    },

    // Cancel challenge after token was deducted — refund and return to pre-reveal
    cancelChallengeRefund() {
        const cp = this.challengePhase;
        if (cp && cp.challengers.length > 0) {
            const current = cp.challengers[cp.currentChallengerIdx];
            this.players[current.playerIndex].tokens = Math.min(this.MAX_TOKENS, this.players[current.playerIndex].tokens + 1);
            cp.challengers.splice(cp.currentChallengerIdx, 1);
            if (cp.currentChallengerIdx >= cp.challengers.length && cp.challengers.length > 0) {
                cp.currentChallengerIdx = cp.challengers.length - 1;
            }
        }
        this._hideOverlay('challenge-overlay');
        this.saveState();
        this.renderScores();
    },

    // Cancel challenge from the challenger timeline view — refund and return to pre-reveal
    cancelChallengeFromTimeline() {
        const cp = this.challengePhase;
        if (cp && cp.challengers.length > 0) {
            const current = cp.challengers[cp.currentChallengerIdx];
            this.players[current.playerIndex].tokens = Math.min(this.MAX_TOKENS, this.players[current.playerIndex].tokens + 1);
            cp.challengers.splice(cp.currentChallengerIdx, 1);
            if (cp.currentChallengerIdx >= cp.challengers.length && cp.challengers.length > 0) {
                cp.currentChallengerIdx = cp.challengers.length - 1;
            }
        }
        // Clean up challenger mode
        this._challengerMode = false;
        this.isWaitingForPlacement = false;
        this.selectedDropIndex = null;
        const confirmEl = document.querySelector('.confirm-placement');
        if (confirmEl) confirmEl.remove();
        document.getElementById('game-actions').innerHTML = '';

        // Restore current player's view and show pre-reveal again
        this.renderScores();
        this.renderCurrentTurn();
        this.renderTimeline();
        this.showPreReveal();
        this.saveState();
    },

    selectChallenger(playerIndex) {
        if (this.players[playerIndex].tokens < 1) return;
        const cp = this.challengePhase;
        this.players[playerIndex].tokens = Math.max(0, this.players[playerIndex].tokens - 1);
        cp.challengers.push({ playerIndex, dropIndex: null });
        cp.currentChallengerIdx = cp.challengers.length - 1;
        this.saveState();
        this.renderScores();
        this._showPassPhoneForChallenger();
    },

    // Show "pass phone to challenger" screen
    _showPassPhoneForChallenger() {
        const cp = this.challengePhase;
        const challenger = cp.challengers[cp.currentChallengerIdx];
        const challengerName = this.escapeHtml(this.players[challenger.playerIndex].name);
        const originalName = this.escapeHtml(this.players[cp.originalPlayerIndex].name);

        const content = document.getElementById('challenge-content');
        content.innerHTML = `
            <div class="pass-phone-icon">&#128241;</div>
            <h2>Gi telefonen til</h2>
            <p class="pass-phone-name">${challengerName}</p>
            <p class="challenge-text">Du skal plassere sangen p\u00e5 <strong>${originalName}s tidslinje</strong> der du mener den h\u00f8rer hjemme. (1 \u{1F536} brukt)</p>
            <button class="btn btn-primary btn-large" onclick="Game.showChallengerTimeline()">Jeg er klar!</button>
            <button class="btn btn-ghost" onclick="Game.cancelChallengeRefund()" style="margin-top:8px">Angre utfordring</button>
        `;
        this._showOverlay('challenge-overlay');
    },

    showChallengerTimeline() {
        // Close BOTH overlays (challenge + reveal)
        this._hideOverlay('challenge-overlay');
        this._hideOverlay('song-reveal-overlay');

        // Set up challenger placement mode
        this._challengerMode = true;
        this.isWaitingForPlacement = true;
        this.hasPlayedSong = true; // Challenger doesn't need to listen again
        this.selectedDropIndex = null;

        // Update UI to show challenger's timeline
        this.renderScores();
        this.renderChallengerTimeline();

        // Update the turn indicator
        const el = document.getElementById('current-turn');
        const cp = this.challengePhase;
        const currentChallenger = cp.challengers[cp.currentChallengerIdx];
        const challengerName = this.escapeHtml(this.players[currentChallenger.playerIndex].name);
        const originalName = this.escapeHtml(this.players[cp.originalPlayerIndex].name);
        el.innerHTML = `<strong>${challengerName}</strong> utfordrer \u2014 plasser sangen p\u00e5 ${originalName}s tidslinje!`;

        // Show cancel button in game actions area
        const actionsEl = document.getElementById('game-actions');
        actionsEl.innerHTML = `<button class="btn btn-ghost action-btn" onclick="Game.cancelChallengeFromTimeline()">Angre utfordring (\u{1F536} refunderes)</button>`;
    },

    renderChallengerTimeline() {
        const el = document.getElementById('timeline');
        const cp = this.challengePhase;
        const originalPlayer = this.players[cp.originalPlayerIndex];

        // Disable original player's position + all previous challengers' positions
        const disabledSet = new Set([cp.originalDropIndex]);
        for (let i = 0; i < cp.currentChallengerIdx; i++) {
            if (cp.challengers[i].dropIndex !== null) {
                disabledSet.add(cp.challengers[i].dropIndex);
            }
        }

        el.innerHTML = this._renderTimelineHTML(originalPlayer, true, 'Game.onChallengerDropZoneClick', disabledSet);
        el.classList.remove('timeline-empty');

        const titleEl = document.getElementById('timeline-title');
        titleEl.textContent = `${this.escapeHtml(originalPlayer.name)}s tidslinje (${originalPlayer.timeline.length} kort)`;
        titleEl.classList.add('challenger');
    },

    onChallengerDropZoneClick(index) {
        if (!this.isWaitingForPlacement || !this._challengerMode) return;
        const cp = this.challengePhase;
        // Block original player's position and all previous challengers' positions
        if (index === cp.originalDropIndex) return;
        for (let i = 0; i < cp.currentChallengerIdx; i++) {
            if (cp.challengers[i].dropIndex === index) return;
        }
        if (this._dropDebounce) return;
        this._dropDebounce = true;
        setTimeout(() => { this._dropDebounce = false; }, 300);
        this.selectedDropIndex = index;
        this.showChallengerPlacementConfirmation(index);
    },

    showChallengerPlacementConfirmation(index) {
        const originalPlayer = this.players[this.challengePhase.originalPlayerIndex];
        this._showPlacementDialog(index, originalPlayer.timeline, 'Game.cancelChallengerPlacement()', 'Game.confirmChallengerPlacement()');
    },

    cancelChallengerPlacement() {
        const existing = document.querySelector('.confirm-placement');
        if (existing) existing.remove();
        this.selectedDropIndex = null;
        document.querySelectorAll('.drop-zone').forEach(dz => dz.classList.remove('highlight'));
    },

    confirmChallengerPlacement() {
        const existing = document.querySelector('.confirm-placement');
        if (existing) existing.remove();
        if (this.selectedDropIndex !== null && this.isWaitingForPlacement) {
            const idx = this.selectedDropIndex;
            this.selectedDropIndex = null;
            this.isWaitingForPlacement = false;
            this._challengerMode = false;

            // Save drop index to current challenger
            const cp = this.challengePhase;
            cp.challengers[cp.currentChallengerIdx].dropIndex = idx;

            // Remove challenger styling from timeline title
            document.getElementById('timeline-title').classList.remove('challenger');

            // Restore original player's timeline view
            this.renderTimeline();
            this.renderCurrentTurn();
            this.saveState();

            // Go back to pre-reveal so another player can challenge
            this.showPreReveal();
        }
    },

    // =============================================
    // Resolution Logic
    // =============================================

    resolvePlacement() {
        const cp = this.challengePhase;
        if (!cp || !this.currentSong) return;

        const originalPlayer = this.players[cp.originalPlayerIndex];
        const originalCorrect = this.isPlacementCorrect(
            originalPlayer.timeline, this.currentSong, cp.originalDropIndex
        );

        const card = {
            title: this.currentSong.title,
            artist: this.currentSong.artist,
            year: this.currentSong.year,
        };

        let result;

        this._lastPlacedCard = null;

        if (cp.challengers.length === 0) {
            // No challenge — standard behavior
            if (originalCorrect) {
                originalPlayer.timeline.splice(cp.originalDropIndex, 0, card);
                originalPlayer.score = originalPlayer.timeline.length;
                this._lastPlacedCard = card;
            }
            result = originalCorrect ? 'no_challenge_correct' : 'no_challenge_wrong';
        } else {
            if (originalCorrect) {
                // Original correct → original keeps card, all challengers lose tokens
                originalPlayer.timeline.splice(cp.originalDropIndex, 0, card);
                originalPlayer.score = originalPlayer.timeline.length;
                this._lastPlacedCard = card;
                result = 'original_wins';
            } else {
                // Original wrong — check challengers in order, first correct wins
                let winnerChallenger = null;
                for (const challenger of cp.challengers) {
                    if (challenger.dropIndex === null) continue; // Skip incomplete placements
                    const challengerCorrect = this.isPlacementCorrect(
                        originalPlayer.timeline, this.currentSong, challenger.dropIndex
                    );
                    if (challengerCorrect) {
                        winnerChallenger = challenger;
                        break;
                    }
                }

                if (winnerChallenger) {
                    // Challenger wins — steal card to their own timeline
                    cp.winnerChallengerPlayerIndex = winnerChallenger.playerIndex;
                    const winner = this.players[winnerChallenger.playerIndex];
                    const insertIdx = this._findChronologicalIndex(winner.timeline, card.year);
                    winner.timeline.splice(insertIdx, 0, card);
                    winner.score = winner.timeline.length;
                    this._lastPlacedCard = card;
                    result = 'challenger_wins';
                } else {
                    // All wrong — nobody gets the card
                    result = cp.challengers.length > 1 ? 'nobody_wins_multi' : 'nobody_wins';
                }
            }
        }

        this.saveState();
        this.showReveal(result);
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
            hasPlayedSong: this.hasPlayedSong,
            isWaitingForPlacement: this.isWaitingForPlacement,
            challengePhase: this.challengePhase,
            titleArtistClaimed: this.titleArtistClaimed,
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
            // Snapshot the database on restore to prevent mid-game corruption
            this._gameDatabase = [...SONGS_DATABASE];
            this.deck = shuffleArray(this._gameDatabase.filter(s => !this.usedSongs.has(this._songKey(s))));
            this.currentSong = state.currentSong || null;
            this.hasPlayedSong = !!state.hasPlayedSong;
            this.isWaitingForPlacement = !!state.isWaitingForPlacement;
            this.selectedDropIndex = null;
            this._isPlaying = false;
            this.challengePhase = state.challengePhase || null;
            this.titleArtistClaimed = !!state.titleArtistClaimed;
            this._challengerMode = false;

            // Backwards compatibility: migrate old challengePhase format (single challenger → array)
            if (this.challengePhase && !Array.isArray(this.challengePhase.challengers)) {
                const cp = this.challengePhase;
                cp.challengers = [];
                if (cp.challengerIndex !== null && cp.challengerIndex !== undefined) {
                    cp.challengers.push({ playerIndex: cp.challengerIndex, dropIndex: cp.challengerDropIndex != null ? cp.challengerDropIndex : null });
                }
                cp.currentChallengerIdx = Math.max(0, cp.challengers.length - 1);
                cp.winnerChallengerPlayerIndex = null;
                delete cp.challengerIndex;
                delete cp.challengerDropIndex;
            }

            // Backwards compatibility: ensure all players have tokens
            this.players.forEach(p => {
                if (typeof p.tokens !== 'number') p.tokens = 3;
            });
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
                        <button class="btn-icon btn-sm" onclick="Game.gmAdjustScore(${i}, -1)">\u2212</button>
                        <span class="gm-player-score">${player.score}</span>
                        <button class="btn-icon btn-sm" onclick="Game.gmAdjustScore(${i}, 1)">+</button>
                        <span class="gm-player-tokens-inline">
                            <button class="btn-icon btn-xs" onclick="Game.gmAdjustTokens(${i}, -1)">\u2212</button>
                            <span>\u{1F536}${player.tokens}</span>
                            <button class="btn-icon btn-xs" onclick="Game.gmAdjustTokens(${i}, 1)">+</button>
                        </span>
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
            <button class="btn btn-secondary gm-btn-skip" onclick="Game.skipSong(); Game.closeMenu();" style="margin-top:10px; width:100%">⏭ Hopp over sang</button>
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
                <button class="gm-card-edit" onclick="Game.gmStartEditCard(${playerIndex}, ${ci})" title="Rediger">✏️</button>
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
            // Show search UI instead of drawing randomly
            this.gmShowAddCard(playerIndex);
            return;
        } else if (delta < 0 && player.timeline.length > 0) {
            player.timeline.pop();
        }
        player.score = player.timeline.length;
        this.saveState();
        this.renderScores();
        this.renderTimeline();
        this.renderMenu();

        // Check if this pushed someone to win
        const winner = this.players.find(p => p.score >= this.cardsToWin);
        if (winner) {
            this.closeMenu();
            this.showWinner(winner);
        }
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

    gmAdjustTokens(playerIndex, delta) {
        const player = this.players[playerIndex];
        player.tokens = Math.max(0, Math.min(this.MAX_TOKENS, player.tokens + delta));
        this.saveState();
        this.renderScores();
        this.renderMenu();
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
        if (!startCard) return; // No songs left
        this.players.push({
            name,
            timeline: [{ title: startCard.title, artist: startCard.artist, year: startCard.year }],
            score: 1,
            tokens: 3,
        });

        this.saveState();
        this.renderScores();
        this.renderMenu();
    },

    gmRemovePlayer(playerIndex) {
        if (this.players.length <= 2) return;

        const wasCurrentPlayer = playerIndex === this.currentPlayerIndex;

        // If removed player is involved in an active challenge, cancel the challenge
        if (this.challengePhase) {
            const cp = this.challengePhase;
            const isOriginal = cp.originalPlayerIndex === playerIndex;
            const isChallenger = cp.challengers.some(c => c.playerIndex === playerIndex);

            if (isOriginal || isChallenger) {
                // Refund tokens for all challengers
                cp.challengers.forEach(c => {
                    if (c.playerIndex < this.players.length) {
                        this.players[c.playerIndex].tokens = Math.min(this.MAX_TOKENS, this.players[c.playerIndex].tokens + 1);
                    }
                });
                this.challengePhase = null;
                this._challengerMode = false;
                this._hideOverlay('challenge-overlay');
                this._hideOverlay('song-reveal-overlay');
            } else {
                // Adjust indices in challengePhase
                if (playerIndex < cp.originalPlayerIndex) {
                    cp.originalPlayerIndex--;
                }
                cp.challengers.forEach(c => {
                    if (playerIndex < c.playerIndex) {
                        c.playerIndex--;
                    }
                });
                if (cp.winnerChallengerPlayerIndex !== null && playerIndex < cp.winnerChallengerPlayerIndex) {
                    cp.winnerChallengerPlayerIndex--;
                }
            }
        }

        this.players.splice(playerIndex, 1);

        if (this.currentPlayerIndex >= this.players.length) {
            this.currentPlayerIndex = 0;
        } else if (playerIndex < this.currentPlayerIndex) {
            this.currentPlayerIndex--;
        }

        if (wasCurrentPlayer) {
            // Clean up any active placement state
            this.isWaitingForPlacement = false;
            this.selectedDropIndex = null;
            this._challengerMode = false;
            const confirmEl = document.querySelector('.confirm-placement');
            if (confirmEl) confirmEl.remove();

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

    // =============================================
    // Song Editing (reveal + GM timeline)
    // =============================================

    gmStartEditSong() {
        if (!this.currentSong) return;
        document.getElementById('edit-song-year').value = this.currentSong.year;
        document.getElementById('edit-song-title').value = this.currentSong.title;
        document.getElementById('edit-song-artist-input').value = this.currentSong.artist;
        document.getElementById('reveal-song-info').style.display = 'none';
        document.getElementById('edit-song-form').style.display = '';
    },

    gmSaveEditSong() {
        const newYear = parseInt(document.getElementById('edit-song-year').value);
        const newTitle = document.getElementById('edit-song-title').value.trim();
        const newArtist = document.getElementById('edit-song-artist-input').value.trim();

        if (!newYear || !newTitle || !newArtist) return;

        // Undo last placement if a card was placed
        if (this._lastPlacedCard) {
            for (const player of this.players) {
                const idx = player.timeline.indexOf(this._lastPlacedCard);
                if (idx !== -1) {
                    player.timeline.splice(idx, 1);
                    player.score = player.timeline.length;
                    break;
                }
            }
            this._lastPlacedCard = null;
        }

        // Reset winner for re-evaluation
        if (this.challengePhase) {
            this.challengePhase.winnerChallengerPlayerIndex = null;
        }

        // Update current song with corrected data
        this.currentSong.year = newYear;
        this.currentSong.title = newTitle;
        this.currentSong.artist = newArtist;

        // Hide edit form, show song info (resolvePlacement → showReveal will update display)
        document.getElementById('edit-song-form').style.display = 'none';
        document.getElementById('reveal-song-info').style.display = '';

        // Re-resolve with corrected data
        this.resolvePlacement();
    },

    gmCancelEditSong() {
        document.getElementById('edit-song-form').style.display = 'none';
        document.getElementById('reveal-song-info').style.display = '';
    },

    // GM timeline card editing
    gmStartEditCard(playerIndex, cardIndex) {
        const player = this.players[playerIndex];
        const card = player.timeline[cardIndex];
        if (!card) return;

        const container = document.getElementById('gm-timeline-cards');
        const cardEls = container.querySelectorAll('.gm-card');
        if (!cardEls[cardIndex]) return;

        cardEls[cardIndex].innerHTML = `
            <div class="gm-card-edit-form">
                <div class="gm-edit-row">
                    <input type="number" id="gm-edit-year" value="${card.year}" class="gm-edit-input gm-edit-year" inputmode="numeric">
                    <input type="text" id="gm-edit-title" value="${this.escapeHtml(card.title)}" class="gm-edit-input gm-edit-title" placeholder="Tittel">
                </div>
                <div class="gm-edit-row">
                    <input type="text" id="gm-edit-artist" value="${this.escapeHtml(card.artist)}" class="gm-edit-input" placeholder="Artist">
                </div>
                <div class="gm-edit-row gm-edit-actions">
                    <button class="btn btn-primary btn-sm" onclick="Game.gmSaveEditCard(${playerIndex}, ${cardIndex})">Lagre</button>
                    <button class="btn btn-ghost btn-sm" onclick="Game.gmCancelEditCard()">Avbryt</button>
                </div>
            </div>`;
    },

    gmSaveEditCard(playerIndex, cardIndex) {
        const player = this.players[playerIndex];
        const card = player.timeline[cardIndex];
        if (!card) return;

        const newYear = parseInt(document.getElementById('gm-edit-year').value);
        const newTitle = document.getElementById('gm-edit-title').value.trim();
        const newArtist = document.getElementById('gm-edit-artist').value.trim();

        if (!newYear || !newTitle || !newArtist) return;

        card.year = newYear;
        card.title = newTitle;
        card.artist = newArtist;

        // Re-sort timeline chronologically
        player.timeline.sort((a, b) => a.year - b.year);

        this.saveState();
        this.renderTimeline();
        this.gmRenderTimeline();
    },

    gmCancelEditCard() {
        this.gmRenderTimeline();
    },

    // GM song search for adding cards
    gmShowAddCard(playerIndex) {
        const container = document.getElementById('gm-timeline-cards');
        container.innerHTML = `
            <div class="gm-add-card-search">
                <input type="text" id="gm-song-search" class="gm-search-input" placeholder="Søk tittel eller artist..." oninput="Game.gmSearchSong(this.value, ${playerIndex})" autocomplete="off">
                <div id="gm-search-results" class="gm-search-results"></div>
                <div class="gm-search-actions">
                    <button class="btn btn-secondary btn-sm" onclick="Game.gmAddRandomCard(${playerIndex})">🎲 Tilfeldig</button>
                    <button class="btn btn-ghost btn-sm" onclick="Game.gmRenderTimeline()">Avbryt</button>
                </div>
            </div>`;
        document.getElementById('gm-song-search').focus();
    },

    _searchResults: [],

    gmSearchSong(query, playerIndex) {
        const resultsEl = document.getElementById('gm-search-results');
        if (!query || query.length < 2) {
            resultsEl.innerHTML = '';
            this._searchResults = [];
            return;
        }

        const q = query.toLowerCase();
        const db = this._gameDatabase || (typeof SONGS_DATABASE !== 'undefined' ? SONGS_DATABASE : []);
        this._searchResults = db.filter(s =>
            s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
        ).slice(0, 10);

        if (this._searchResults.length === 0) {
            resultsEl.innerHTML = '<p class="gm-empty">Ingen treff</p>';
            return;
        }

        resultsEl.innerHTML = this._searchResults.map((song, i) => `
            <div class="gm-search-result" onclick="Game.gmAddSearchedCardByIndex(${playerIndex}, ${i})">
                <span class="gm-search-year">${song.year}</span>
                <span class="gm-search-title">${this.escapeHtml(song.title)}</span>
                <span class="gm-search-artist">${this.escapeHtml(song.artist)}</span>
            </div>
        `).join('');
    },

    gmAddSearchedCardByIndex(playerIndex, songIndex) {
        const song = this._searchResults[songIndex];
        if (!song) return;
        this.gmAddSearchedCard(playerIndex, song.title, song.artist, song.year);
    },

    gmAddSearchedCard(playerIndex, title, artist, year) {
        const player = this.players[playerIndex];
        const card = { title, artist, year };
        player.timeline.push(card);
        player.timeline.sort((a, b) => a.year - b.year);
        player.score = player.timeline.length;

        this.saveState();
        this.renderScores();
        this.renderTimeline();
        this.renderMenu();

        const winner = this.players.find(p => p.score >= this.cardsToWin);
        if (winner) {
            this.closeMenu();
            this.showWinner(winner);
        }
    },

    gmAddRandomCard(playerIndex) {
        const card = this.drawSong();
        if (!card) return;
        const player = this.players[playerIndex];
        player.timeline.push({ title: card.title, artist: card.artist, year: card.year });
        player.timeline.sort((a, b) => a.year - b.year);
        player.score = player.timeline.length;

        this.saveState();
        this.renderScores();
        this.renderTimeline();
        this.renderMenu();

        const winner = this.players.find(p => p.score >= this.cardsToWin);
        if (winner) {
            this.closeMenu();
            this.showWinner(winner);
        }
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

    // Scroll-lock: prevent background scrolling when overlays are open
    _updateScrollLock() {
        const anyOverlay = document.querySelector('.overlay.active');
        document.body.classList.toggle('overlay-active', !!anyOverlay);
    },

    _showOverlay(id) {
        document.getElementById(id).classList.add('active');
        this._updateScrollLock();
    },

    _hideOverlay(id) {
        document.getElementById(id).classList.remove('active');
        this._updateScrollLock();
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
        // Cancel challenger placement confirmation if visible
        if (Game._challengerMode && Game.selectedDropIndex !== null) {
            Game.cancelChallengerPlacement();
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
