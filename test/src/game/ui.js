// Game UI rendering — timeline, scores, overlays, game actions

import { escapeHtml } from '../utils.js';

export const uiMethods = {
    escapeHtml,

    // ─── Screen Reader Announcements ───

    _announce(message) {
        const el = document.getElementById('a11y-announcements');
        if (!el) return;
        // Clear then set to trigger announcement even if same text
        el.textContent = '';
        setTimeout(() => {
            el.textContent = message;
        }, 0);
    },

    // ─── Rendering ───

    renderScores() {
        const el = document.getElementById('game-scores');
        const chips = el.querySelectorAll('.score-chip');

        // Rebuild only if player count changed, otherwise update in-place
        if (chips.length !== this.players.length) {
            el.innerHTML = this.players
                .map(
                    (p, i) => `
                <div class="score-chip ${i === this.currentPlayerIndex ? 'active' : ''}" aria-label="${escapeHtml(p.name)}: ${p.score} av ${this.cardsToWin} kort, ${p.tokens} poletter">
                    <span class="score-label">${escapeHtml(p.name)}: ${p.score}/${this.cardsToWin}</span>
                    <span class="token-count"><span class="token-icon">\u{1F536}</span>${p.tokens}</span>
                </div>
            `,
                )
                .join('');
        } else {
            this.players.forEach((p, i) => {
                const chip = chips[i];
                chip.classList.toggle('active', i === this.currentPlayerIndex);
                chip.setAttribute(
                    'aria-label',
                    `${p.name}: ${p.score} av ${this.cardsToWin} kort, ${p.tokens} poletter`,
                );
                const label = chip.querySelector('.score-label');
                if (label) label.textContent = `${p.name}: ${p.score}/${this.cardsToWin}`;
                const tokenEl = chip.querySelector('.token-count');
                if (tokenEl) tokenEl.lastChild.textContent = p.tokens;
            });
        }
        this.renderGameInfo();
    },

    renderGameInfo() {
        const el = document.getElementById('game-info-bar');
        if (!el) return;
        const remaining = this.deck ? this.deck.length : 0;
        el.innerHTML = `<span>${remaining} kort igjen i bunken</span>`;
    },

    renderCurrentTurn() {
        const el = document.getElementById('current-turn');
        el.innerHTML = `<strong>${escapeHtml(this.currentPlayer.name)}</strong> sin tur`;
        this._announce(`${this.currentPlayer.name} sin tur`);
    },

    _renderTimelineHTML(player, showDropZones, dropClickFn, disabledDropIndices) {
        const timeline = player.timeline;
        let html = '';
        /* eslint-disable eqeqeq -- intentional null/undefined check */
        const disabledSet =
            disabledDropIndices instanceof Set
                ? disabledDropIndices
                : disabledDropIndices != null
                  ? new Set([disabledDropIndices])
                  : new Set();
        /* eslint-enable eqeqeq */

        // Build aria-labels based on surrounding years
        const dropAriaLabel = index => {
            if (timeline.length === 0) return 'Plasser sang her';
            if (index === 0) {
                return `Plasser før ${timeline[0].year}`;
            }
            if (index === timeline.length) {
                return `Plasser etter ${timeline[timeline.length - 1].year}`;
            }
            return `Plasser mellom ${timeline[index - 1].year} og ${timeline[index].year}`;
        };

        if (showDropZones) {
            const isDisabled = disabledSet.has(0);
            const label = timeline.length === 0 ? 'Plasser her' : 'Eldst';
            if (isDisabled) {
                html += `<div class="drop-zone disabled" aria-disabled="true"><span>\u{1F6AB} Opptatt</span></div>`;
            } else {
                html += `<div class="drop-zone" role="button" tabindex="0" aria-label="${dropAriaLabel(0)}" onclick="${dropClickFn}(0)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${dropClickFn}(0)}"><span>${label}</span></div>`;
            }
        }

        for (let i = 0; i < timeline.length; i++) {
            const card = timeline[i];
            const altText = card.coverUrl ? `${escapeHtml(card.title)} av ${escapeHtml(card.artist)}` : '';
            const coverImg = card.coverUrl
                ? `<img src="${card.coverUrl}" alt="${altText}" class="card-cover" loading="lazy">`
                : '';
            html += `
                <div class="timeline-card" role="listitem">
                    ${coverImg}
                    <span class="card-year">${card.year}</span>
                    <div class="card-info">
                        <div class="card-title">${escapeHtml(card.title)}</div>
                        <div class="card-artist">${escapeHtml(card.artist)}</div>
                    </div>
                </div>
            `;

            if (showDropZones) {
                const dropIndex = i + 1;
                const isDisabled = disabledSet.has(dropIndex);
                const label = i === timeline.length - 1 ? 'Nyest' : '';
                if (isDisabled) {
                    html += `<div class="drop-zone disabled" aria-disabled="true"><span>\u{1F6AB} Opptatt</span></div>`;
                } else {
                    html += `<div class="drop-zone" role="button" tabindex="0" aria-label="${dropAriaLabel(dropIndex)}" onclick="${dropClickFn}(${dropIndex})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${dropClickFn}(${dropIndex})}"><span>${label || 'Plasser her'}</span></div>`;
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
        titleEl.textContent = `${escapeHtml(player.name)}s tidslinje (${player.timeline.length} kort)`;
        titleEl.classList.remove('challenger');
    },

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

    _showNotification(message, duration) {
        const toast = document.getElementById('notification-toast');
        if (!toast) return;
        toast.textContent = message;
        toast.style.display = '';
        toast.classList.add('visible');
        if (this._notificationTimeout) clearTimeout(this._notificationTimeout);
        this._notificationTimeout = setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => {
                toast.style.display = 'none';
            }, 300);
        }, duration || 3000);
    },
};
