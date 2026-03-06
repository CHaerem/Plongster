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
    loadSong(spotifyId) {
        const uri = `spotify:track:${spotifyId}`;

        // Reset cover UI - disable play button until controller is ready
        const playBtn = document.getElementById('cover-play-btn');
        playBtn.style.display = '';
        playBtn.disabled = true;
        playBtn.style.opacity = '0.4';
        document.getElementById('listening-bars').style.display = 'none';
        document.querySelector('.listening-text').textContent = 'Laster sang...';

        // Destroy old controller so we get a fresh one each turn
        this.embedController = null;

        if (this.spotifyAPI) {
            const container = document.getElementById('spotify-embed');
            container.innerHTML = '<div id="spotify-iframe"></div>';
            this.spotifyAPI.createController(
                document.getElementById('spotify-iframe'),
                { uri, height: 152, width: '100%', theme: 0 },
                (controller) => {
                    this.embedController = controller;

                    // Use ready event for reliable "controller is ready" detection
                    controller.addListener('ready', () => {
                        playBtn.disabled = false;
                        playBtn.style.opacity = '';
                        document.querySelector('.listening-text').textContent = 'Trykk for å spille';
                    });

                    // Listen for real playback state changes
                    controller.addListener('playback_update', (e) => {
                        if (!e.data) return;
                        const bars = document.getElementById('listening-bars');
                        const btn = document.getElementById('cover-play-btn');
                        const text = document.querySelector('.listening-text');

                        if (!e.data.isPaused && !e.data.isBuffering) {
                            // Audio is actually playing
                            btn.style.display = 'none';
                            bars.style.display = 'flex';
                            text.textContent = 'Lytt og plasser sangen i tidslinjen';
                        } else if (e.data.isPaused) {
                            // Paused - show play button again
                            btn.style.display = '';
                            btn.disabled = false;
                            btn.style.opacity = '';
                            bars.style.display = 'none';
                            text.textContent = 'Trykk for å spille';
                        }
                    });
                }
            );
        } else {
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
        }
    },

    // Called from play button on cover (direct user gesture = reliable)
    togglePlay() {
        if (this.embedController) {
            this.embedController.togglePlay();
        }
        // Show immediate feedback while waiting for playback_update
        document.querySelector('.listening-text').textContent = 'Starter avspilling...';
    },

    // Start a new turn
    async startTurn() {
        this.currentSong = this.drawSong();
        this.isWaitingForPlacement = true;
        this.selectedDropIndex = null;

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

        overlay.classList.add('active');
    },

    nextTurn() {
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

        if (this.isWaitingForPlacement) {
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

            if (this.isWaitingForPlacement) {
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
            return true;
        } catch {
            return false;
        }
    },

    clearState() {
        localStorage.removeItem('hitster-game');
    },

    escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
};

// Spotify IFrame API callback
window.onSpotifyIframeApiReady = (IFrameAPI) => {
    Game.spotifyAPI = IFrameAPI;
};
