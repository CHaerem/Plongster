// Core game logic — init, draw, placement check, turn start

import { getSongs } from '../songs.js';
import { escapeHtml, shuffleArray } from '../utils.js';
import { Phase, transition } from './phases.js';

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
        this.gamePhase = Phase.IDLE;

        this.players = playerNames.map(name => {
            const startCard = this.drawSong();
            if (!startCard) return { name, timeline: [], score: 0, tokens: 3 };
            return {
                name,
                timeline: [
                    {
                        title: startCard.title,
                        artist: startCard.artist,
                        year: startCard.year,
                        coverUrl: startCard.coverUrl || null,
                    },
                ],
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
        this.gamePhase = transition(this.gamePhase, Phase.GAME_OVER);
        this.pausePlayback();
        const winner = [...this.players].sort((a, b) => b.score - a.score)[0];
        document.getElementById('winner-name').textContent = winner.name;
        const scoresEl = document.getElementById('final-scores');
        scoresEl.innerHTML = `<p style="margin-bottom:10px;color:var(--text-dim)">Alle sanger er brukt opp!</p>${this.players
            .map(
                p =>
                    `<div class="final-score-row"><span>${escapeHtml(p.name)}</span><span>${p.score} kort \u00B7 \u{1F536}${p.tokens}</span></div>`,
            )
            .join('')}`;
        localStorage.removeItem('plongster-game-state');
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

    // ─── Turn Start ───

    startTurn(resumeSong) {
        if (resumeSong) {
            this.currentSong = resumeSong;
        } else {
            this.currentSong = this.drawSong();
            if (!this.currentSong) return;
        }
        this.gamePhase = transition(this.gamePhase, Phase.LISTENING);
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
            // Song unavailable — auto-skip to next song
            this._showNotification('Sang uten avspillings-ID hoppet over');
            const nextSong = this.drawSong();
            if (nextSong && this._isValidSpotifyId(nextSong.spotifyId)) {
                this.currentSong = nextSong;
                this.saveState();
                this.loadSong(nextSong.spotifyId);
            } else {
                // Fallback: let player place without audio
                this._updatePlaybackUI('error');
                this.hasPlayedSong = true;
                this.gamePhase = transition(this.gamePhase, Phase.PLACING);
                this.renderTimeline();
            }
        }
    },
};
