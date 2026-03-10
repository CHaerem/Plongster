// Game state persistence — save/restore/clear to localStorage
// Versioned format with migration chain for backward compatibility

import { getSongs } from '../songs.js';
import { shuffleArray } from '../utils.js';
import { Phase } from './phases.js';

const STATE_VERSION = 2;

// ─── Migration Chain ───

/**
 * Migrate V1 (unversioned) state to V2.
 * V1 used boolean flags; V2 adds gamePhase and stateVersion.
 */
function migrateV1toV2(state) {
    // Infer gamePhase from boolean flags
    if (state.challengePhase) {
        state.gamePhase = Phase.PRE_REVEAL;
    } else if (state.currentSong) {
        state.gamePhase = state.hasPlayedSong ? Phase.PLACING : Phase.LISTENING;
    } else {
        state.gamePhase = Phase.PASS_PHONE;
    }
    state.stateVersion = 2;
    return state;
}

const MIGRATIONS = [
    // [fromVersion, migrateFn]
    [1, migrateV1toV2],
];

/**
 * Run migrations to bring state up to current version.
 * Returns the migrated state, or null if migration fails.
 */
function migrateState(state) {
    let version = state.stateVersion || 1;

    for (const [fromVersion, migrateFn] of MIGRATIONS) {
        if (version === fromVersion) {
            try {
                state = migrateFn(state);
                version = state.stateVersion;
            } catch (e) {
                console.warn(`Migration V${fromVersion} failed:`, e);
                return null;
            }
        }
    }

    if (version !== STATE_VERSION) {
        console.warn(`Unknown state version ${version}, expected ${STATE_VERSION}`);
        return null;
    }

    return state;
}

// ─── Validation ───

function isValidState(state) {
    if (!state || typeof state !== 'object') return false;
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
    // Validate gamePhase if present (V2+)
    if (state.gamePhase && !Object.values(Phase).includes(state.gamePhase)) return false;
    return true;
}

// ─── Public Methods ───

export const stateMethods = {
    saveState() {
        const state = {
            stateVersion: STATE_VERSION,
            players: this.players,
            currentPlayerIndex: this.currentPlayerIndex,
            cardsToWin: this.cardsToWin,
            usedSongs: [...this.usedSongs],
            currentSong: this.currentSong,
            hasPlayedSong: this.hasPlayedSong,
            isWaitingForPlacement: this.isWaitingForPlacement,
            challengePhase: this.challengePhase,
            titleArtistClaimed: this.titleArtistClaimed,
            gamePhase: this.gamePhase,
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
            let state = JSON.parse(data);

            // Validate basic structure before migration
            if (!isValidState(state)) return false;

            // Run migrations if needed
            state = migrateState(state);
            if (!state) {
                this.clearState();
                return false;
            }

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
            this.gamePhase = state.gamePhase || Phase.PASS_PHONE;

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
