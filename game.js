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
    lastPlacement: null,

    // Initialize a new game
    init(playerNames, cardsToWin) {
        this.cardsToWin = cardsToWin;
        this.currentPlayerIndex = 0;
        this.usedSongs = new Set();
        this.deck = shuffleArray(SONGS_DATABASE);
        this.currentSong = null;
        this.isWaitingForPlacement = false;
        this.selectedDropIndex = null;

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

    // Draw next song from deck
    drawSong() {
        while (this.deck.length > 0) {
            const song = this.deck.pop();
            const key = `${song.title}-${song.artist}`;
            if (!this.usedSongs.has(key)) {
                this.usedSongs.add(key);
                return song;
            }
        }
        // Reshuffle if needed
        this.deck = shuffleArray(SONGS_DATABASE.filter(s => {
            const key = `${s.title}-${s.artist}`;
            return !this.usedSongs.has(key);
        }));
        if (this.deck.length === 0) {
            this.usedSongs.clear();
            this.deck = shuffleArray(SONGS_DATABASE);
        }
        return this.deck.pop();
    },

    // Load song into hidden embed (user triggers play via cover button)
    _loadGeneration: 0,
    _loadTimeout: null,

    loadSong(spotifyId) {
        // Increment generation to invalidate any stale callbacks
        this._loadGeneration++;
        const gen = this._loadGeneration;

        // Clear any pending retry timeout
        if (this._loadTimeout) {
            clearTimeout(this._loadTimeout);
            this._loadTimeout = null;
        }

        // Reset cover UI - disable play button until controller is ready
        const playBtn = document.getElementById('cover-play-btn');
        playBtn.style.display = '';
        playBtn.disabled = true;
        playBtn.style.opacity = '0.4';
        document.getElementById('listening-bars').style.display = 'none';
        document.querySelector('.listening-text').textContent = 'Laster sang...';

        if (!this.spotifyAPI) {
            this.stopPlayback();
            const container = document.getElementById('spotify-embed');
            container.innerHTML = `<iframe
                src="https://open.spotify.com/embed/track/${spotifyId}?theme=0"
                width="100%"
                height="152"
                frameBorder="0"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                loading="lazy"></iframe>`;
            playBtn.disabled = false;
            playBtn.style.opacity = '';
            document.querySelector('.listening-text').textContent = 'Trykk for å spille';
            return;
        }

        const uri = `spotify:track:${spotifyId}`;

        // Strategy 1: Reuse existing controller with loadUri (fast, avoids flaky creation)
        if (this.embedController) {
            try {
                this.embedController.loadUri(uri);
                this._addSpotifyListeners(this.embedController, gen);

                // Short timeout — loadUri on existing controller should be fast
                this._loadTimeout = setTimeout(() => {
                    if (gen !== this._loadGeneration) return;
                    // loadUri didn't work — destroy and create fresh controller
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

    // Shared listener setup — used by both loadUri and createController paths
    _addSpotifyListeners(controller, gen) {
        controller.addListener('ready', () => {
            if (gen !== this._loadGeneration) return;
            if (this._loadTimeout) {
                clearTimeout(this._loadTimeout);
                this._loadTimeout = null;
            }
            const playBtn = document.getElementById('cover-play-btn');
            playBtn.disabled = false;
            playBtn.style.opacity = '';
            document.querySelector('.listening-text').textContent = 'Trykk for å spille';
        });

        controller.addListener('playback_update', (e) => {
            if (gen !== this._loadGeneration) return;
            if (!e.data) return;
            const bars = document.getElementById('listening-bars');
            const btn = document.getElementById('cover-play-btn');
            const text = document.querySelector('.listening-text');

            if (!e.data.isPaused && !e.data.isBuffering) {
                // Audio is actually playing — clear any pending timeout
                if (this._loadTimeout) {
                    clearTimeout(this._loadTimeout);
                    this._loadTimeout = null;
                }
                btn.style.display = 'none';
                bars.style.display = 'flex';
                text.textContent = 'Lytt og plasser sangen i tidslinjen';
                if (!this.hasPlayedSong) {
                    this.hasPlayedSong = true;
                    this.renderTimeline();
                }
            } else if (e.data.isPaused) {
                btn.style.display = '';
                btn.disabled = false;
                btn.style.opacity = '';
                bars.style.display = 'none';
                text.textContent = 'Trykk for å spille';
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
                const playBtn = document.getElementById('cover-play-btn');
                playBtn.disabled = false;
                playBtn.style.opacity = '';
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
                    this._addSpotifyListeners(controller, gen);
                }
            );
        } catch (e) {
            console.error('Spotify createController error:', e);
            if (gen !== this._loadGeneration) return;
            if (this._loadTimeout) {
                clearTimeout(this._loadTimeout);
                this._loadTimeout = null;
            }
            const playBtn = document.getElementById('cover-play-btn');
            playBtn.disabled = false;
            playBtn.style.opacity = '';
            document.querySelector('.listening-text').textContent = 'Trykk for å prøve igjen';
        }
    },

    // Pause playback but keep controller alive for reuse
    pausePlayback() {
        if (this._loadTimeout) {
            clearTimeout(this._loadTimeout);
            this._loadTimeout = null;
        }
        if (this.embedController) {
            try { this.embedController.togglePlay(); } catch (e) {}
        }
    },

    // Stop playback and destroy the embed completely
    stopPlayback() {
        // Cancel any pending load timeout/retry
        if (this._loadTimeout) {
            clearTimeout(this._loadTimeout);
            this._loadTimeout = null;
        }
        if (this.embedController) {
            try { this.embedController.togglePlay(); } catch (e) {}
            this.embedController = null;
        }
        const container = document.getElementById('spotify-embed');
        if (container) container.innerHTML = '';
    },

    // Called from play button on cover (direct user gesture = reliable)
    togglePlay() {
        if (this.embedController) {
            try {
                this.embedController.togglePlay();
            } catch (e) {
                console.error('togglePlay error:', e);
                // If togglePlay fails, try reloading the song
                if (this.currentSong && this.currentSong.spotifyId) {
                    this.loadSong(this.currentSong.spotifyId);
                }
                return;
            }
        } else if (this.currentSong && this.currentSong.spotifyId) {
            // No controller exists (was destroyed or never created) - reload
            this.loadSong(this.currentSong.spotifyId);
            return;
        }
        // Show immediate feedback while waiting for playback_update
        document.querySelector('.listening-text').textContent = 'Starter avspilling...';
    },

    // Start a new turn
    async startTurn() {
        this.currentSong = this.drawSong();
        this.isWaitingForPlacement = true;
        this.selectedDropIndex = null;
        this.hasPlayedSong = false;

        // Update UI
        this.renderScores();
        this.renderCurrentTurn();
        this.renderTimeline();

        // Hide embed and show listening cover, then load + autoplay
        const wrapper = document.querySelector('.spotify-player-wrapper');
        wrapper.classList.add('hidden-player');
        if (this.currentSong.spotifyId) {
            this.loadSong(this.currentSong.spotifyId);
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
        this.isWaitingForPlacement = false;
        // Pause playback but keep controller alive for reuse next turn
        this.pausePlayback();

        const player = this.currentPlayer;
        const correct = this.isPlacementCorrect(player.timeline, this.currentSong, dropIndex);

        // Store undo data BEFORE modifying timeline
        this.lastPlacement = {
            playerIndex: this.currentPlayerIndex,
            song: { ...this.currentSong },
            wasCorrect: correct,
            timelineBefore: player.timeline.map(c => ({ ...c })),
            scoreBefore: player.score,
        };

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

    // Undo last placement and let player try again
    undoPlacement() {
        if (!this.lastPlacement) return;

        const lp = this.lastPlacement;
        const player = this.players[lp.playerIndex];

        // Restore timeline and score
        player.timeline = lp.timelineBefore;
        player.score = lp.scoreBefore;

        // Restore current song so player can re-place
        this.currentSong = lp.song;
        this.isWaitingForPlacement = true;
        this.selectedDropIndex = null;
        this.hasPlayedSong = true; // Keep drop zones visible

        // Clear undo (only one undo per placement)
        this.lastPlacement = null;

        // Close reveal overlay
        document.getElementById('song-reveal-overlay').classList.remove('active');

        // Re-render
        this.renderScores();
        this.renderTimeline();
        this.saveState();
    },

    showReveal(correct) {
        const overlay = document.getElementById('song-reveal-overlay');
        const icon = document.getElementById('reveal-result-icon');
        const title = document.getElementById('reveal-title');
        const name = document.getElementById('reveal-song-name');
        const artist = document.getElementById('reveal-song-artist');
        const year = document.getElementById('reveal-song-year');
        const spotifyLink = document.getElementById('reveal-spotify-link');

        icon.className = 'reveal-icon ' + (correct ? 'correct' : 'wrong');
        title.textContent = correct ? 'Riktig!' : 'Feil!';
        name.textContent = this.currentSong.title;
        artist.textContent = this.currentSong.artist;
        year.textContent = this.currentSong.year;

        if (this.currentSong.spotifyId) {
            spotifyLink.href = `https://open.spotify.com/track/${this.currentSong.spotifyId}`;
            spotifyLink.style.display = 'inline-flex';
        } else {
            spotifyLink.style.display = 'none';
        }

        // Show undo button only if we have undo data
        const undoBtn = document.getElementById('reveal-undo-btn');
        undoBtn.style.display = this.lastPlacement ? '' : 'none';

        overlay.classList.add('active');
    },

    nextTurn() {
        this.lastPlacement = null;
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

    // Show "pass the phone" interstitial between turns
    showPassPhone() {
        const passOverlay = document.getElementById('pass-phone-overlay');
        document.getElementById('pass-phone-name').textContent = this.currentPlayer.name;
        passOverlay.classList.add('active');
    },

    // Called when next player is ready
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
        if (this.selectedDropIndex !== null) {
            this.placeSong(this.selectedDropIndex);
        }
    },

    // Save game state to localStorage
    saveState() {
        const state = {
            players: this.players,
            currentPlayerIndex: this.currentPlayerIndex,
            cardsToWin: this.cardsToWin,
            usedSongs: [...this.usedSongs],
            lastPlacement: this.lastPlacement,
        };
        localStorage.setItem('hitster-game', JSON.stringify(state));
    },

    // Restore game state from localStorage (returns true if restored)
    restoreState() {
        const data = localStorage.getItem('hitster-game');
        if (!data) return false;
        try {
            const state = JSON.parse(data);
            this.players = state.players;
            this.currentPlayerIndex = state.currentPlayerIndex;
            this.cardsToWin = state.cardsToWin;
            this.usedSongs = new Set(state.usedSongs);
            this.deck = shuffleArray(SONGS_DATABASE.filter(s => {
                const key = `${s.title}-${s.artist}`;
                return !this.usedSongs.has(key);
            }));
            this.currentSong = null;
            this.isWaitingForPlacement = false;
            this.selectedDropIndex = null;
            this.lastPlacement = state.lastPlacement || null;
            return true;
        } catch {
            return false;
        }
    },

    clearState() {
        localStorage.removeItem('hitster-game');
    },

    // --- Hamburger Menu ---
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

        // Section: Players & Scores
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

        // Section: Timeline Editor
        html += '<div class="gm-section"><h4>Rediger tidslinje</h4>';
        html += '<select id="gm-timeline-player" onchange="Game.gmRenderTimeline()">';
        this.players.forEach((player, i) => {
            html += `<option value="${i}" ${i === this.currentPlayerIndex ? 'selected' : ''}>${this.escapeHtml(player.name)} (${player.timeline.length} kort)</option>`;
        });
        html += '</select>';
        html += '<div id="gm-timeline-cards"></div>';
        html += '</div>';

        // Section: Restart
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

    // --- Game Master Actions ---
    gmMovePlayer(playerIndex, direction) {
        const newIndex = playerIndex + direction;
        if (newIndex < 0 || newIndex >= this.players.length) return;

        // Swap players
        [this.players[playerIndex], this.players[newIndex]] = [this.players[newIndex], this.players[playerIndex]];

        // Keep currentPlayerIndex pointing to the same player
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
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
};

// Spotify IFrame API callback
window.onSpotifyIframeApiReady = (IFrameAPI) => {
    Game.spotifyAPI = IFrameAPI;
};
