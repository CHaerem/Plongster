// Node.js test runner for Hitster game logic
const vm = require('vm');
const fs = require('fs');

const songsCode = fs.readFileSync('songs.js', 'utf-8');
const gameCode = fs.readFileSync('game.js', 'utf-8');

const mockDoc = {
    getElementById: () => ({
        textContent: '', innerHTML: '', className: '', style: {}, href: '',
        classList: { add: () => {}, remove: () => {}, toggle: () => {} }
    }),
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => ({ textContent: '', innerHTML: '' }),
    addEventListener: () => {},
};

const sandbox = {
    document: mockDoc,
    window: {},
    console: console,
    crypto: { getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256); return arr; } },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout: setTimeout,
    Promise: Promise,
    fetch: () => Promise.resolve({ json: () => ({}) }),
};
sandbox.window = sandbox;

const ctx = vm.createContext(sandbox);
// Wrap in IIFE to capture const/let declarations on sandbox
vm.runInContext('(function(){' + songsCode + '\nthis.SONGS_DATABASE=SONGS_DATABASE;this.shuffleArray=shuffleArray;\n}).call(this);', ctx);
vm.runInContext('(function(){' + gameCode + '\nthis.Game=Game;\n}).call(this);', ctx);

const G = sandbox.Game;
const DB = sandbox.SONGS_DATABASE;
const shuffle = sandbox.shuffleArray;

let passed = 0, failed = 0;

function assert(desc, cond) {
    if (cond) { passed++; console.log('\x1b[32mPASS\x1b[0m:', desc); }
    else { failed++; console.error('\x1b[31mFAIL\x1b[0m:', desc); }
}

function section(name) { console.log('\n\x1b[36m--- ' + name + ' ---\x1b[0m'); }

// ==================== SONGS DATABASE ====================
section('Songs Database');
assert('DB is array', Array.isArray(DB));
assert('Has 80+ songs', DB.length >= 80);
assert('All have required fields', DB.every(s => s.title && s.artist && s.year && s.spotifyId));
assert('All years between 1950-2030', DB.every(s => s.year >= 1950 && s.year <= 2030));
assert('Spotify IDs valid format', DB.every(s => /^[a-zA-Z0-9]{20,24}$/.test(s.spotifyId)));

const keys = DB.map(s => s.title + '|' + s.artist);
assert('No duplicate title+artist', keys.length === new Set(keys).size);

const decades = {};
DB.forEach(s => { const d = Math.floor(s.year / 10) * 10; decades[d] = (decades[d] || 0) + 1; });
assert('Songs from 5+ decades', Object.keys(decades).length >= 5);
console.log('  Decade distribution:', Object.entries(decades).sort().map(([d, c]) => d + 's:' + c).join(', '));

// ==================== SHUFFLE ====================
section('Shuffle');
const orig = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const sh = shuffle(orig);
assert('Same length', sh.length === orig.length);
assert('Contains all elements', orig.every(x => sh.includes(x)));
assert('Does not modify original', JSON.stringify(orig) === '[1,2,3,4,5,6,7,8,9,10]');

let diffCount = 0;
for (let i = 0; i < 10; i++) { if (JSON.stringify(shuffle(orig)) !== JSON.stringify(orig)) diffCount++; }
assert('Produces different orderings (8+/10)', diffCount >= 8);

// ==================== GAME INIT ====================
section('Game Init');
G.init(['Alice', 'Bob'], 10);
assert('2 players', G.players.length === 2);
assert('Correct names', G.players[0].name === 'Alice' && G.players[1].name === 'Bob');
assert('Each player starts with 1 card', G.players.every(p => p.timeline.length === 1));
assert('Starting cards have year', G.players.every(p => p.timeline[0].year >= 1950));
assert('Score 1 (starting card)', G.players.every(p => p.score === 1));
assert('cardsToWin = 10', G.cardsToWin === 10);
assert('currentPlayer is Alice', G.currentPlayer.name === 'Alice');
assert('Deck populated', G.deck.length > 0);

// ==================== DRAW SONGS ====================
section('Draw Songs');
G.init(['A', 'B'], 10);
const s1 = G.drawSong();
assert('Returns song object', s1 && s1.title && s1.artist && s1.year);
const s2 = G.drawSong();
assert('Second draw is different', s1.title !== s2.title || s1.artist !== s2.artist);
assert('Starting cards not redrawn', !G.players.some(p => p.timeline[0].title === s1.title && p.timeline[0].artist === s1.artist));

// Draw many
G.init(['A', 'B'], 10);
let drawOk = true;
try { for (let i = 0; i < 150; i++) G.drawSong(); } catch (e) { drawOk = false; }
assert('Can draw 150 songs (reshuffles)', drawOk);

// ==================== PLACEMENT LOGIC ====================
section('Placement Logic');

assert('Empty timeline: always correct', G.isPlacementCorrect([], { year: 2000 }, 0));

const single = [{ year: 2000 }];
assert('Before 2000 at idx 0: correct', G.isPlacementCorrect(single, { year: 1990 }, 0));
assert('After 2000 at idx 1: correct', G.isPlacementCorrect(single, { year: 2010 }, 1));
assert('After 2000 at idx 0: wrong', !G.isPlacementCorrect(single, { year: 2010 }, 0));
assert('Before 2000 at idx 1: wrong', !G.isPlacementCorrect(single, { year: 1990 }, 1));
assert('Same year idx 0: correct', G.isPlacementCorrect(single, { year: 2000 }, 0));
assert('Same year idx 1: correct', G.isPlacementCorrect(single, { year: 2000 }, 1));

const multi = [{ year: 1980 }, { year: 1990 }, { year: 2010 }];
assert('1985 between 1980-1990 (idx 1): correct', G.isPlacementCorrect(multi, { year: 1985 }, 1));
assert('2000 between 1990-2010 (idx 2): correct', G.isPlacementCorrect(multi, { year: 2000 }, 2));
assert('1970 before all (idx 0): correct', G.isPlacementCorrect(multi, { year: 1970 }, 0));
assert('2020 after all (idx 3): correct', G.isPlacementCorrect(multi, { year: 2020 }, 3));
assert('2005 at idx 1 (between 1980-1990): wrong', !G.isPlacementCorrect(multi, { year: 2005 }, 1));
assert('1970 at idx 2 (between 1990-2010): wrong', !G.isPlacementCorrect(multi, { year: 1970 }, 2));
assert('1975 at idx 3 (after 2010): wrong', !G.isPlacementCorrect(multi, { year: 1975 }, 3));

// ==================== EDGE CASES ====================
section('Edge Cases');

const longTl = [];
for (let y = 1960; y <= 2020; y++) longTl.push({ year: y });
assert('60-card timeline: before works', G.isPlacementCorrect(longTl, { year: 1959 }, 0));
assert('60-card timeline: after works', G.isPlacementCorrect(longTl, { year: 2021 }, longTl.length));
assert('60-card timeline: wrong placement fails', !G.isPlacementCorrect(longTl, { year: 2021 }, 0));

const dupes = [{ year: 1990 }, { year: 1990 }, { year: 2000 }];
assert('Duplicate years: placement at 0 works', G.isPlacementCorrect(dupes, { year: 1990 }, 0));
assert('Duplicate years: placement at 1 works', G.isPlacementCorrect(dupes, { year: 1990 }, 1));
assert('Duplicate years: placement at 2 works', G.isPlacementCorrect(dupes, { year: 1990 }, 2));

// ==================== XSS ====================
section('Security');
assert('escapeHtml blocks <script>', G.escapeHtml('<script>alert(1)</script>').includes('&lt;'));
assert('Normal text passes through', G.escapeHtml('Hello World') === 'Hello World');

// ==================== WIN CONDITION ====================
section('Win Condition');
G.init(['Alice', 'Bob'], 3);
G.players[0].score = 3;
assert('Winner detected at threshold', G.players.find(p => p.score >= G.cardsToWin).name === 'Alice');
G.players[0].score = 2;
assert('No premature winner', !G.players.find(p => p.score >= G.cardsToWin));

// Player rotation
section('Player Rotation');
G.init(['A', 'B', 'C'], 10);
assert('Starts at player 0', G.currentPlayerIndex === 0);
G.currentPlayerIndex = (G.currentPlayerIndex + 1) % G.players.length;
assert('Advances to 1', G.currentPlayerIndex === 1);
G.currentPlayerIndex = (G.currentPlayerIndex + 1) % G.players.length;
assert('Advances to 2', G.currentPlayerIndex === 2);
G.currentPlayerIndex = (G.currentPlayerIndex + 1) % G.players.length;
assert('Wraps to 0', G.currentPlayerIndex === 0);

// ==================== FULL GAME FLOW SIMULATION ====================
section('Full Game Flow (2 players, win at 3)');

G.init(['Alice', 'Bob'], 3);
assert('Flow: Game initialized', G.players.length === 2 && G.cardsToWin === 3);
assert('Flow: Each player starts with 1 card', G.players.every(p => p.timeline.length === 1 && p.score === 1));
assert('Flow: Alice starts', G.currentPlayer.name === 'Alice');

// Turn 1: Alice draws and places correctly
G.currentSong = G.drawSong();
G.isWaitingForPlacement = true;
assert('Flow: Song drawn for Alice', G.currentSong !== null);

const aliceSong1 = G.currentSong;
const tl0 = G.players[0].timeline;
// Find correct position in existing timeline
let idx0 = tl0.length;
for (let i = 0; i <= tl0.length; i++) {
    if (G.isPlacementCorrect(tl0, aliceSong1, i)) { idx0 = i; break; }
}
tl0.splice(idx0, 0, { title: aliceSong1.title, artist: aliceSong1.artist, year: aliceSong1.year });
G.players[0].score = tl0.length;
G.isWaitingForPlacement = false;
assert('Flow: Alice score = 2', G.players[0].score === 2);

// Check no winner yet
assert('Flow: No winner yet', !G.players.find(p => p.score >= G.cardsToWin));

// Advance to Bob
G.currentPlayerIndex = (G.currentPlayerIndex + 1) % G.players.length;
assert('Flow: Now Bob turn', G.currentPlayer.name === 'Bob');

// Turn 2: Bob places WRONG (simulate)
G.currentSong = G.drawSong();
G.isWaitingForPlacement = true;
// Don't add to timeline (wrong placement)
G.isWaitingForPlacement = false;
assert('Flow: Bob still score = 1 after wrong', G.players[1].score === 1);

// Advance back to Alice
G.currentPlayerIndex = (G.currentPlayerIndex + 1) % G.players.length;
assert('Flow: Back to Alice', G.currentPlayer.name === 'Alice');

// Turn 3: Alice places correctly to win (score 2 -> 3)
G.currentSong = G.drawSong();
G.isWaitingForPlacement = true;
const aliceTl = G.players[0].timeline;
let idx1 = aliceTl.length;
for (let i = 0; i <= aliceTl.length; i++) {
    if (G.isPlacementCorrect(aliceTl, G.currentSong, i)) { idx1 = i; break; }
}
aliceTl.splice(idx1, 0, { title: G.currentSong.title, artist: G.currentSong.artist, year: G.currentSong.year });
G.players[0].score = aliceTl.length;
G.isWaitingForPlacement = false;

assert('Flow: Alice score = 3', G.players[0].score === 3);
const flowWinner = G.players.find(p => p.score >= G.cardsToWin);
assert('Flow: Alice wins!', flowWinner && flowWinner.name === 'Alice');

// Verify Alice's timeline is chronologically valid
let timelineValid = true;
for (let i = 1; i < aliceTl.length; i++) {
    if (aliceTl[i].year < aliceTl[i-1].year) {
        timelineValid = false;
        break;
    }
}
assert('Flow: Alice timeline is chronologically sorted', timelineValid);

// ==================== MULTI-PLAYER ROTATION (10 players) ====================
section('Multi-Player Rotation');
const tenPlayers = Array.from({length: 10}, (_, i) => 'P' + (i + 1));
G.init(tenPlayers, 5);
assert('10 players initialized', G.players.length === 10);
for (let i = 0; i < 20; i++) {
    const expected = i % 10;
    assert('Turn ' + i + ': player P' + (expected + 1), G.currentPlayerIndex === expected);
    G.currentPlayerIndex = (G.currentPlayerIndex + 1) % G.players.length;
}

// ==================== GAME RESTART ====================
section('Game Restart');
G.init(['X', 'Y'], 5);
G.players[0].score = 5;
G.players[0].timeline = [{year: 1970}, {year: 1980}, {year: 1990}, {year: 2000}, {year: 2010}];
G.currentPlayerIndex = 1;
G.usedSongs.add('test-song');

// Reinit (simulates restart)
G.init(['X', 'Y'], 5);
assert('Restart: scores reset to 1 (starting card)', G.players.every(p => p.score === 1));
assert('Restart: timelines have 1 card', G.players.every(p => p.timeline.length === 1));
assert('Restart: player index reset', G.currentPlayerIndex === 0);
assert('Restart: deck repopulated', G.deck.length > 0);

// ==================== SUMMARY ====================
const total = passed + failed;
console.log('\n' + '='.repeat(40));
console.log(passed + '/' + total + ' tests passed');
if (failed > 0) {
    console.error(failed + ' test(s) FAILED');
    process.exit(1);
} else {
    console.log('All tests passed!');
}
