// Game state persistence — save/restore/clear to localStorage

import { getSongs } from '../songs.js';
import { shuffleArray } from '../utils.js';

export const stateMethods = {
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
            if (
                !state.players.every(
                    p =>
                        typeof p.name === 'string' &&
                        p.name.length > 0 &&
                        Array.isArray(p.timeline) &&
                        typeof p.score === 'number',
                )
            )
                return false;

            this.players = state.players;
            this.players.forEach(p => {
                p.score = p.timeline.length;
            });
            this.currentPlayerIndex = state.currentPlayerIndex;
            this.cardsToWin = state.cardsToWin;
            this.usedSongs = new Set(Array.isArray(state.usedSongs) ? state.usedSongs : []);
            this._gameDatabase = [...getSongs()];
            this.deck = shuffleArray(this._gameDatabase.filter(s => !this.usedSongs.has(this._songKey(s))));
            this.currentSong = state.currentSong || null;
            this.hasPlayedSong = !!state.hasPlayedSong;
            this.isWaitingForPlacement = !!state.isWaitingForPlacement;
            this.selectedDropIndex = null;
            this._isPlaying = false;
            this.challengePhase = state.challengePhase || null;
            this.titleArtistClaimed = !!state.titleArtistClaimed;
            this._challengerMode = false;

            // Backwards compatibility: migrate old challengePhase format
            if (this.challengePhase && !Array.isArray(this.challengePhase.challengers)) {
                const cp = this.challengePhase;
                cp.challengers = [];
                if (cp.challengerIndex !== null && cp.challengerIndex !== undefined) {
                    /* eslint-disable eqeqeq -- intentional null/undefined check */
                    cp.challengers.push({
                        playerIndex: cp.challengerIndex,
                        dropIndex: cp.challengerDropIndex != null ? cp.challengerDropIndex : null,
                    });
                    /* eslint-enable eqeqeq */
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
            this.clearState();
            return false;
        }
    },

    clearState() {
        localStorage.removeItem('hitster-game');
    },
};
