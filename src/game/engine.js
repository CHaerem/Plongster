// Core game logic — init, turns, placement, challenges, resolution

import { getSongs } from '../songs.js';
import { escapeHtml, shuffleArray } from '../utils.js';

export const engineMethods = {
    // Initialize a new game
    init(playerNames, cardsToWin) {
        this.cardsToWin = cardsToWin;
        this.currentPlayerIndex = 0;
        this.usedSongs = new Set();
        this._gameDatabase = [...getSongs()];
        this.deck = shuffleArray(this._gameDatabase);
        this.currentSong = null;
        this.isWaitingForPlacement = false;
        this.selectedDropIndex = null;
        this._isPlaying = false;
        this._apiRetryCount = 0;
        this.challengePhase = null;
        this.titleArtistClaimed = false;

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
        const db = this._gameDatabase || getSongs();
        this.deck = shuffleArray(db.filter(s => !this.usedSongs.has(this._songKey(s))));
        if (this.deck.length > 0) {
            const song = this.deck.pop();
            this.usedSongs.add(this._songKey(song));
            return song;
        }
        this.endGameNoSongs();
        return null;
    },

    endGameNoSongs() {
        this.pausePlayback();
        const winner = [...this.players].sort((a, b) => b.score - a.score)[0];
        document.getElementById('winner-name').textContent = winner.name;
        const scoresEl = document.getElementById('final-scores');
        scoresEl.innerHTML =
            '<p style="margin-bottom:10px;color:var(--text-dim)">Alle sanger er brukt opp!</p>' +
            this.players
                .map(
                    p =>
                        `<div class="final-score-row"><span>${escapeHtml(p.name)}</span><span>${p.score} kort \u00B7 \u{1F536}${p.tokens}</span></div>`,
                )
                .join('');
        localStorage.removeItem('hitster-game-state');
        window.App.showScreen('screen-winner');
    },

    isPlacementCorrect(timeline, song, index) {
        const year = song.year;
        if (index > 0 && timeline[index - 1].year > year) return false;
        if (index < timeline.length && timeline[index].year < year) return false;
        return true;
    },

    _findChronologicalIndex(timeline, year) {
        for (let i = 0; i < timeline.length; i++) {
            if (year <= timeline[i].year) return i;
        }
        return timeline.length;
    },

    // ─── Turn Management ───

    startTurn(resumeSong) {
        if (resumeSong) {
            this.currentSong = resumeSong;
        } else {
            this.currentSong = this.drawSong();
            if (!this.currentSong) return;
        }
        this.isWaitingForPlacement = true;
        this.selectedDropIndex = null;
        this.hasPlayedSong = false;
        this._isPlaying = false;

        this.saveState();

        this.renderScores();
        this.renderCurrentTurn();
        this.renderTimeline();
        this.renderGameActions();

        const wrapper = document.querySelector('.spotify-player-wrapper');
        wrapper.classList.add('hidden-player');
        if (this.currentSong && this._isValidSpotifyId(this.currentSong.spotifyId)) {
            this.loadSong(this.currentSong.spotifyId);
        } else {
            this._updatePlaybackUI('error');
            document.querySelector('.listening-text').textContent = 'Sangen har ingen avspillings-ID.';
            this.hasPlayedSong = true;
            this.renderTimeline();
        }
    },

    // ─── Placement ───

    onDropZoneClick(index) {
        if (!this.isWaitingForPlacement) return;
        if (this._dropDebounce) return;
        this._dropDebounce = true;
        setTimeout(() => {
            this._dropDebounce = false;
        }, 300);
        this.selectedDropIndex = index;
        this.showPlacementConfirmation(index);
    },

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
        this._showPlacementDialog(
            index,
            this.currentPlayer.timeline,
            'Game.cancelPlacement()',
            'Game.confirmPlacement()',
        );
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
            this.selectedDropIndex = null;
            this.isWaitingForPlacement = false;
            this.pausePlayback();

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

    // ─── Challenge Phase ───

    showPreReveal() {
        const cp = this.challengePhase;
        const placedChallengers = cp.challengers.filter(c => c.dropIndex !== null).length;

        if (placedChallengers === 0) {
            this.titleArtistClaimed = false;
        }

        document.getElementById('pre-reveal').style.display = '';
        document.getElementById('reveal-result').style.display = 'none';
        this._showOverlay('song-reveal-overlay');

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

        const challengeBtn = document.getElementById('btn-challenge');
        if (challengeBtn) {
            const alreadyChallenging = new Set(cp.challengers.map(c => c.playerIndex));
            const eligiblePlayers = this.players.filter(
                (p, i) => i !== cp.originalPlayerIndex && !alreadyChallenging.has(i) && p.tokens >= 1,
            );
            const originalPlayer = this.players[cp.originalPlayerIndex];
            const totalDropZones = originalPlayer.timeline.length + 1;
            const usedPositions = new Set([cp.originalDropIndex]);
            cp.challengers.forEach(c => {
                if (c.dropIndex !== null) usedPositions.add(c.dropIndex);
            });
            const availablePositions = totalDropZones - usedPositions.size;
            challengeBtn.style.display = eligiblePlayers.length > 0 && availablePositions > 0 ? '' : 'none';
        }

        document.getElementById('game-actions').innerHTML = '';
        this.saveState();
    },

    toggleTitleClaim() {
        this.titleArtistClaimed = !this.titleArtistClaimed;
        const btn = document.getElementById('btn-claim-title');
        if (btn) {
            btn.classList.toggle('active', this.titleArtistClaimed);
        }
        this.saveState();
    },

    confirmTitleClaim(correct) {
        const tokenText = document.getElementById('token-award-text');
        const tokenButtons = document.getElementById('token-award-buttons');
        const claimPlayer = this.players[this.challengePhase.originalPlayerIndex];

        if (correct) {
            if (claimPlayer.tokens < this.MAX_TOKENS) {
                claimPlayer.tokens += 1;
                tokenText.textContent = `${escapeHtml(claimPlayer.name)} fikk +1 \u{1F536} for tittel og artist! (\u{1F536}${claimPlayer.tokens})`;
                tokenText.className = 'token-award-text earned';
            } else {
                tokenText.textContent = `Riktig! Men maks tokens (${this.MAX_TOKENS}) \u2014 ingen token tildelt`;
                tokenText.className = 'token-award-text';
            }
        } else {
            tokenText.textContent = `${escapeHtml(claimPlayer.name)} gjettet feil \u2014 ingen token`;
            tokenText.className = 'token-award-text';
        }
        tokenButtons.style.display = 'none';
        document.getElementById('btn-next-turn').style.display = '';
        this.saveState();
        this.renderScores();
    },

    skipChallenge() {
        this.resolvePlacement();
    },

    startChallenge() {
        const cp = this.challengePhase;
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

        let playerButtons = '';
        otherPlayers.forEach(({ player, index }) => {
            playerButtons += `<button class="challenge-player-btn" onclick="Game.selectChallenger(${index})">${escapeHtml(player.name)} (\u{1F536}${player.tokens})</button>`;
        });

        content.innerHTML = `
            <h2>Hvem utfordrer?</h2>
            <p class="challenge-text">Koster 1 \u{1F536} \u00e5 utfordre:</p>
            <div class="challenge-player-list">${playerButtons}</div>
            <button class="btn btn-ghost" onclick="Game.cancelChallenge()">Avbryt</button>
        `;
        this._showOverlay('challenge-overlay');
    },

    cancelChallenge() {
        this._hideOverlay('challenge-overlay');
        this.saveState();
    },

    cancelChallengeRefund() {
        const cp = this.challengePhase;
        if (cp && cp.challengers.length > 0) {
            const current = cp.challengers[cp.currentChallengerIdx];
            this.players[current.playerIndex].tokens = Math.min(
                this.MAX_TOKENS,
                this.players[current.playerIndex].tokens + 1,
            );
            cp.challengers.splice(cp.currentChallengerIdx, 1);
            if (cp.currentChallengerIdx >= cp.challengers.length && cp.challengers.length > 0) {
                cp.currentChallengerIdx = cp.challengers.length - 1;
            }
        }
        this._hideOverlay('challenge-overlay');
        this.saveState();
        this.renderScores();
    },

    cancelChallengeFromTimeline() {
        const cp = this.challengePhase;
        if (cp && cp.challengers.length > 0) {
            const current = cp.challengers[cp.currentChallengerIdx];
            this.players[current.playerIndex].tokens = Math.min(
                this.MAX_TOKENS,
                this.players[current.playerIndex].tokens + 1,
            );
            cp.challengers.splice(cp.currentChallengerIdx, 1);
            if (cp.currentChallengerIdx >= cp.challengers.length && cp.challengers.length > 0) {
                cp.currentChallengerIdx = cp.challengers.length - 1;
            }
        }
        this._challengerMode = false;
        this.isWaitingForPlacement = false;
        this.selectedDropIndex = null;
        const confirmEl = document.querySelector('.confirm-placement');
        if (confirmEl) confirmEl.remove();
        document.getElementById('game-actions').innerHTML = '';

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

    _showPassPhoneForChallenger() {
        const cp = this.challengePhase;
        const challenger = cp.challengers[cp.currentChallengerIdx];
        const challengerName = escapeHtml(this.players[challenger.playerIndex].name);
        const originalName = escapeHtml(this.players[cp.originalPlayerIndex].name);

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
        this._hideOverlay('challenge-overlay');
        this._hideOverlay('song-reveal-overlay');

        this._challengerMode = true;
        this.isWaitingForPlacement = true;
        this.hasPlayedSong = true;
        this.selectedDropIndex = null;

        this.renderScores();
        this.renderChallengerTimeline();

        const el = document.getElementById('current-turn');
        const cp = this.challengePhase;
        const currentChallenger = cp.challengers[cp.currentChallengerIdx];
        const challengerName = escapeHtml(this.players[currentChallenger.playerIndex].name);
        const originalName = escapeHtml(this.players[cp.originalPlayerIndex].name);
        el.innerHTML = `<strong>${challengerName}</strong> utfordrer \u2014 plasser sangen p\u00e5 ${originalName}s tidslinje!`;

        const actionsEl = document.getElementById('game-actions');
        actionsEl.innerHTML = `<button class="btn btn-ghost action-btn" onclick="Game.cancelChallengeFromTimeline()">Angre utfordring (\u{1F536} refunderes)</button>`;
    },

    renderChallengerTimeline() {
        const el = document.getElementById('timeline');
        const cp = this.challengePhase;
        const originalPlayer = this.players[cp.originalPlayerIndex];

        const disabledSet = new Set([cp.originalDropIndex]);
        for (let i = 0; i < cp.currentChallengerIdx; i++) {
            if (cp.challengers[i].dropIndex !== null) {
                disabledSet.add(cp.challengers[i].dropIndex);
            }
        }

        el.innerHTML = this._renderTimelineHTML(originalPlayer, true, 'Game.onChallengerDropZoneClick', disabledSet);
        el.classList.remove('timeline-empty');

        const titleEl = document.getElementById('timeline-title');
        titleEl.textContent = `${escapeHtml(originalPlayer.name)}s tidslinje (${originalPlayer.timeline.length} kort)`;
        titleEl.classList.add('challenger');
    },

    onChallengerDropZoneClick(index) {
        if (!this.isWaitingForPlacement || !this._challengerMode) return;
        const cp = this.challengePhase;
        if (index === cp.originalDropIndex) return;
        for (let i = 0; i < cp.currentChallengerIdx; i++) {
            if (cp.challengers[i].dropIndex === index) return;
        }
        if (this._dropDebounce) return;
        this._dropDebounce = true;
        setTimeout(() => {
            this._dropDebounce = false;
        }, 300);
        this.selectedDropIndex = index;
        this.showChallengerPlacementConfirmation(index);
    },

    showChallengerPlacementConfirmation(index) {
        const originalPlayer = this.players[this.challengePhase.originalPlayerIndex];
        this._showPlacementDialog(
            index,
            originalPlayer.timeline,
            'Game.cancelChallengerPlacement()',
            'Game.confirmChallengerPlacement()',
        );
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

            const cp = this.challengePhase;
            cp.challengers[cp.currentChallengerIdx].dropIndex = idx;

            document.getElementById('timeline-title').classList.remove('challenger');

            this.renderTimeline();
            this.renderCurrentTurn();
            this.saveState();
            this.showPreReveal();
        }
    },

    // ─── Resolution ───

    showReveal(result) {
        this._hideOverlay('challenge-overlay');
        this._showOverlay('song-reveal-overlay');

        document.getElementById('edit-song-form').style.display = 'none';
        document.getElementById('reveal-song-info').style.display = '';

        document.getElementById('pre-reveal').style.display = 'none';
        const resultSection = document.getElementById('reveal-result');
        resultSection.style.display = '';

        const icon = document.getElementById('reveal-result-icon');
        const title = document.getElementById('reveal-title');
        const subtitle = document.getElementById('reveal-subtitle');
        const name = document.getElementById('reveal-song-name');
        const artist = document.getElementById('reveal-song-artist');
        const year = document.getElementById('reveal-song-year');

        const isPositive = result === 'no_challenge_correct' || result === 'original_wins';

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
                subtitle.textContent = `${escapeHtml(this.players[this.challengePhase.originalPlayerIndex].name)} beholder kortet`;
                subtitle.className = 'reveal-subtitle';
                break;
            case 'challenger_wins':
                icon.className = 'reveal-icon stolen';
                title.textContent = 'Stjålet!';
                subtitle.textContent = `${escapeHtml(this.players[this.challengePhase.winnerChallengerPlayerIndex].name)} stjal kortet!`;
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

        if ('vibrate' in navigator) {
            navigator.vibrate(isPositive ? [50] : [100, 50, 100]);
        }

        const tokenSection = document.getElementById('token-award-section');
        const tokenText = document.getElementById('token-award-text');
        const tokenButtons = document.getElementById('token-award-buttons');
        const nextTurnBtn = document.getElementById('btn-next-turn');
        if (this.titleArtistClaimed) {
            const claimPlayer = this.players[this.challengePhase.originalPlayerIndex];
            tokenText.textContent = `${escapeHtml(claimPlayer.name)} hevdet \u00e5 vite tittel og artist \u2014 stemte det?`;
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

    resolvePlacement() {
        const cp = this.challengePhase;
        if (!cp || !this.currentSong) return;

        const originalPlayer = this.players[cp.originalPlayerIndex];
        const originalCorrect = this.isPlacementCorrect(
            originalPlayer.timeline,
            this.currentSong,
            cp.originalDropIndex,
        );

        const card = {
            title: this.currentSong.title,
            artist: this.currentSong.artist,
            year: this.currentSong.year,
        };

        let result;
        this._lastPlacedCard = null;

        if (cp.challengers.length === 0) {
            if (originalCorrect) {
                originalPlayer.timeline.splice(cp.originalDropIndex, 0, card);
                originalPlayer.score = originalPlayer.timeline.length;
                this._lastPlacedCard = card;
            }
            result = originalCorrect ? 'no_challenge_correct' : 'no_challenge_wrong';
        } else {
            if (originalCorrect) {
                originalPlayer.timeline.splice(cp.originalDropIndex, 0, card);
                originalPlayer.score = originalPlayer.timeline.length;
                this._lastPlacedCard = card;
                result = 'original_wins';
            } else {
                let winnerChallenger = null;
                for (const challenger of cp.challengers) {
                    if (challenger.dropIndex === null) continue;
                    const challengerCorrect = this.isPlacementCorrect(
                        originalPlayer.timeline,
                        this.currentSong,
                        challenger.dropIndex,
                    );
                    if (challengerCorrect) {
                        winnerChallenger = challenger;
                        break;
                    }
                }

                if (winnerChallenger) {
                    cp.winnerChallengerPlayerIndex = winnerChallenger.playerIndex;
                    const winner = this.players[winnerChallenger.playerIndex];
                    const insertIdx = this._findChronologicalIndex(winner.timeline, card.year);
                    winner.timeline.splice(insertIdx, 0, card);
                    winner.score = winner.timeline.length;
                    this._lastPlacedCard = card;
                    result = 'challenger_wins';
                } else {
                    result = cp.challengers.length > 1 ? 'nobody_wins_multi' : 'nobody_wins';
                }
            }
        }

        this.saveState();
        this.showReveal(result);
    },

    nextTurn() {
        this.currentSong = null;
        this.challengePhase = null;
        this.titleArtistClaimed = false;
        this._challengerMode = false;
        this._lastPlacedCard = null;

        this._hideOverlay('song-reveal-overlay');

        document.getElementById('pre-reveal').style.display = '';
        document.getElementById('reveal-result').style.display = 'none';

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
        scoresEl.innerHTML = sorted
            .map(
                p => `
            <div class="final-score-row ${p === winner ? 'winner' : ''}">
                <span class="final-score-name">${escapeHtml(p.name)}</span>
                <span class="final-score-count">${p.score} kort \u00B7 \u{1F536}${p.tokens}</span>
            </div>
        `,
            )
            .join('');

        window.App.showScreen('screen-winner');
    },
};
