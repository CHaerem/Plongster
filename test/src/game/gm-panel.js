// Game Master panel — in-game admin controls

import { escapeHtml } from '../utils.js';
import { getSongs } from '../songs.js';

export const gmMethods = {
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
                        <button class="btn-icon btn-xs" data-action="gm-move-player" data-player="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>▲</button>
                        <button class="btn-icon btn-xs" data-action="gm-move-player" data-player="${i}" data-dir="1" ${i === this.players.length - 1 ? 'disabled' : ''}>▼</button>
                    </div>
                    <span class="gm-player-name">${escapeHtml(player.name)}</span>
                    <div class="gm-player-actions">
                        <button class="btn-icon btn-sm" data-action="gm-adjust-score" data-player="${i}" data-delta="-1">\u2212</button>
                        <span class="gm-player-score">${player.score}</span>
                        <button class="btn-icon btn-sm" data-action="gm-adjust-score" data-player="${i}" data-delta="1">+</button>
                        <span class="gm-player-tokens-inline">
                            <button class="btn-icon btn-xs" data-action="gm-adjust-tokens" data-player="${i}" data-delta="-1">\u2212</button>
                            <span>\u{1F536}${player.tokens}</span>
                            <button class="btn-icon btn-xs" data-action="gm-adjust-tokens" data-player="${i}" data-delta="1">+</button>
                        </span>
                        ${this.players.length > 2 ? `<button class="btn-icon btn-sm gm-btn-remove" data-action="gm-remove-player" data-player="${i}">&times;</button>` : ''}
                    </div>
                </div>`;
        });
        html += `
            <div class="gm-add-player-row">
                <input type="text" id="gm-new-player-name" placeholder="Ny spiller" maxlength="15">
                <button class="btn btn-secondary btn-sm" data-action="gm-add-player">+</button>
            </div>`;
        html += '</div>';

        html += '<div class="gm-section"><h4>Rediger tidslinje</h4>';
        html += '<select id="gm-timeline-player" data-action="gm-render-timeline">';
        this.players.forEach((player, i) => {
            html += `<option value="${i}" ${i === this.currentPlayerIndex ? 'selected' : ''}>${escapeHtml(player.name)} (${player.timeline.length} kort)</option>`;
        });
        html += '</select>';
        html += '<div id="gm-timeline-cards"></div>';
        html += '</div>';

        html += `<div class="gm-section"><h4>Info</h4>
            <p class="gm-empty">${this.deck.length} sanger igjen i bunken</p>
            <button class="btn btn-secondary gm-btn-skip" data-action="gm-skip-song" style="margin-top:10px; width:100%">⏭ Hopp over sang</button>
        </div>`;

        html += `<div class="gm-section">
            <button class="btn btn-danger gm-btn-restart" data-action="gm-restart">Start på nytt</button>
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

        container.innerHTML = player.timeline
            .map(
                (card, ci) => `
            <div class="gm-card">
                <span class="gm-card-year">${card.year}</span>
                <span class="gm-card-title">${escapeHtml(card.title)}</span>
                <button class="gm-card-edit" data-action="gm-start-edit-card" data-player="${playerIndex}" data-card="${ci}" title="Rediger">✏️</button>
                <button class="gm-card-remove" data-action="gm-remove-card" data-player="${playerIndex}" data-card="${ci}">&times;</button>
            </div>
        `,
            )
            .join('');
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

    // ─── Shared Card Insertion ───

    _gmInsertCard(playerIndex, card) {
        const player = this.players[playerIndex];
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

    gmAdjustScore(playerIndex, delta) {
        const player = this.players[playerIndex];
        if (delta > 0) {
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
        if (!startCard) return;
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

        if (this.challengePhase) {
            const cp = this.challengePhase;
            const isOriginal = cp.originalPlayerIndex === playerIndex;
            const isChallenger = cp.challengers.some(c => c.playerIndex === playerIndex);

            if (isOriginal || isChallenger) {
                cp.challengers.forEach(c => {
                    if (c.playerIndex < this.players.length) {
                        this.players[c.playerIndex].tokens = Math.min(
                            this.MAX_TOKENS,
                            this.players[c.playerIndex].tokens + 1,
                        );
                    }
                });
                this.challengePhase = null;
                this._challengerMode = false;
                this._hideOverlay('challenge-overlay');
                this._hideOverlay('song-reveal-overlay');
            } else {
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

    // ─── Song Editing ───

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

        if (this.challengePhase) {
            this.challengePhase.winnerChallengerPlayerIndex = null;
        }

        this.currentSong.year = newYear;
        this.currentSong.title = newTitle;
        this.currentSong.artist = newArtist;

        document.getElementById('edit-song-form').style.display = 'none';
        document.getElementById('reveal-song-info').style.display = '';

        this.resolvePlacement();
    },

    gmCancelEditSong() {
        document.getElementById('edit-song-form').style.display = 'none';
        document.getElementById('reveal-song-info').style.display = '';
    },

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
                    <input type="text" id="gm-edit-title" value="${escapeHtml(card.title)}" class="gm-edit-input gm-edit-title" placeholder="Tittel">
                </div>
                <div class="gm-edit-row">
                    <input type="text" id="gm-edit-artist" value="${escapeHtml(card.artist)}" class="gm-edit-input" placeholder="Artist">
                </div>
                <div class="gm-edit-row gm-edit-actions">
                    <button class="btn btn-primary btn-sm" data-action="gm-save-edit-card" data-player="${playerIndex}" data-card="${cardIndex}">Lagre</button>
                    <button class="btn btn-ghost btn-sm" data-action="gm-cancel-edit-card">Avbryt</button>
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

        player.timeline.sort((a, b) => a.year - b.year);

        this.saveState();
        this.renderTimeline();
        this.gmRenderTimeline();
    },

    gmCancelEditCard() {
        this.gmRenderTimeline();
    },

    gmShowAddCard(playerIndex) {
        const container = document.getElementById('gm-timeline-cards');
        container.innerHTML = `
            <div class="gm-add-card-search">
                <input type="text" id="gm-song-search" class="gm-search-input" placeholder="Søk tittel eller artist..." data-action="gm-search-song" data-player="${playerIndex}" autocomplete="off">
                <div id="gm-search-results" class="gm-search-results"></div>
                <div class="gm-search-actions">
                    <button class="btn btn-secondary btn-sm" data-action="gm-add-random-card" data-player="${playerIndex}">🎲 Tilfeldig</button>
                    <button class="btn btn-ghost btn-sm" data-action="gm-render-timeline">Avbryt</button>
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
        const db = this._gameDatabase || getSongs();
        this._searchResults = db
            .filter(s => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q))
            .slice(0, 10);

        if (this._searchResults.length === 0) {
            resultsEl.innerHTML = '<p class="gm-empty">Ingen treff</p>';
            return;
        }

        resultsEl.innerHTML = this._searchResults
            .map(
                (song, i) => `
            <div class="gm-search-result" data-action="gm-add-searched-card" data-player="${playerIndex}" data-song-index="${i}">
                <span class="gm-search-year">${song.year}</span>
                <span class="gm-search-title">${escapeHtml(song.title)}</span>
                <span class="gm-search-artist">${escapeHtml(song.artist)}</span>
            </div>
        `,
            )
            .join('');
    },

    gmAddSearchedCard(playerIndex, songIndex) {
        const song = this._searchResults[songIndex];
        if (!song) return;
        this._gmInsertCard(playerIndex, { title: song.title, artist: song.artist, year: song.year });
    },

    gmAddRandomCard(playerIndex) {
        const card = this.drawSong();
        if (!card) return;
        this._gmInsertCard(playerIndex, { title: card.title, artist: card.artist, year: card.year });
    },

    gmRestart() {
        if (!confirm('Er du sikker på at du vil starte på nytt?')) return;
        this.stopPlayback();
        this.closeMenu();
        this.clearState();
        window.App.showScreen('screen-setup');
    },
};
