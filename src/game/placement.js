// Placement UI flow — drop zone handling, confirmation dialogs
// Covers both player placement and challenger placement

import { createDebounce } from '../utils.js';
import { Phase, transition } from './phases.js';

const _dropDebounce = createDebounce(300);

export const placementMethods = {
    // ─── Shared Helpers ───

    _cancelPlacementUI() {
        const existing = document.querySelector('.confirm-placement');
        if (existing) existing.remove();
        this.selectedDropIndex = null;
        document.querySelectorAll('.drop-zone').forEach(dz => dz.classList.remove('highlight'));
    },

    _showPlacementDialog(index, timeline, confirmAction, cancelAction) {
        const existing = document.querySelector('.confirm-placement');
        if (existing) existing.remove();

        let positionText = '';
        if (timeline.length === 0) {
            positionText = 'Start tidslinjen med denne sangen?';
        } else if (index === 0) {
            positionText = `Plassere før ${timeline[0].year}?`;
        } else if (index === timeline.length) {
            positionText = `Plassere etter ${timeline[timeline.length - 1].year}?`;
        } else {
            positionText = `Plassere mellom ${timeline[index - 1].year} og ${timeline[index].year}?`;
        }

        const html = `
            <div class="confirm-placement slide-up">
                <p>${positionText}</p>
                <div class="confirm-buttons">
                    <button class="btn btn-secondary" data-action="${cancelAction}">Avbryt</button>
                    <button class="btn btn-success" data-action="${confirmAction}">Bekreft</button>
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

    // ─── Player Placement ───

    onDropZoneClick(index) {
        if (!this.isWaitingForPlacement) return;
        if (_dropDebounce()) return;
        this.selectedDropIndex = index;
        this.showPlacementConfirmation(index);
    },

    showPlacementConfirmation(index) {
        this.gamePhase = transition(this.gamePhase, Phase.PLACEMENT_CONFIRM);
        this._showPlacementDialog(index, this.currentPlayer.timeline, 'confirm-placement', 'cancel-placement');
    },

    cancelPlacement() {
        this.gamePhase = transition(this.gamePhase, Phase.PLACING);
        this._cancelPlacementUI();
    },

    confirmPlacement() {
        const existing = document.querySelector('.confirm-placement');
        if (existing) existing.remove();
        if (this.selectedDropIndex !== null && this.isWaitingForPlacement) {
            const idx = this.selectedDropIndex;
            this.selectedDropIndex = null;
            this.isWaitingForPlacement = false;
            this.pausePlayback();
            this.gamePhase = transition(this.gamePhase, Phase.PRE_REVEAL);

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

    // ─── Challenger Placement ───

    onChallengerDropZoneClick(index) {
        if (!this.isWaitingForPlacement || !this._challengerMode) return;
        const cp = this.challengePhase;
        if (index === cp.originalDropIndex) return;
        for (let i = 0; i < cp.currentChallengerIdx; i++) {
            if (cp.challengers[i].dropIndex === index) return;
        }
        if (_dropDebounce()) return;
        this.selectedDropIndex = index;
        this.showChallengerPlacementConfirmation(index);
    },

    showChallengerPlacementConfirmation(index) {
        this.gamePhase = transition(this.gamePhase, Phase.CHALLENGER_CONFIRM);
        const originalPlayer = this.players[this.challengePhase.originalPlayerIndex];
        this._showPlacementDialog(
            index,
            originalPlayer.timeline,
            'confirm-challenger-placement',
            'cancel-challenger-placement',
        );
    },

    cancelChallengerPlacement() {
        this.gamePhase = transition(this.gamePhase, Phase.CHALLENGER_PLACING);
        this._cancelPlacementUI();
    },

    confirmChallengerPlacement() {
        const existing = document.querySelector('.confirm-placement');
        if (existing) existing.remove();
        if (this.selectedDropIndex !== null && this.isWaitingForPlacement) {
            const idx = this.selectedDropIndex;
            this.selectedDropIndex = null;
            this.isWaitingForPlacement = false;
            this._challengerMode = false;
            this.gamePhase = transition(this.gamePhase, Phase.PRE_REVEAL);

            const cp = this.challengePhase;
            cp.challengers[cp.currentChallengerIdx].dropIndex = idx;

            document.getElementById('timeline-title').classList.remove('challenger');

            this.renderTimeline();
            this.renderCurrentTurn();
            this.saveState();
            this.showPreReveal();
        }
    },
};
