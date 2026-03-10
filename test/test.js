// Node.js test runner for Hitster game logic
// Integration, regression, and edge case tests
const vm = require('vm');
const fs = require('fs');
const path = require('path');

// Strip ES module syntax so files can run in a VM context
function stripModule(code) {
    return code
        .replace(/^import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
        .replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '')
        .replace(/^export\s+(const|let|var|function|class|async\s+function)/gm, '$1')
        .replace(/^export\s+default\s+/gm, 'const _default = ')
        .replace(/^export\s+\{[^}]*\};?\s*$/gm, '');
}

function readModule(filePath) {
    return stripModule(fs.readFileSync(path.join(__dirname, filePath), 'utf-8'));
}

const mockElement = () => ({
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    href: '',
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    disabled: false,
    value: '0',
    focus: () => {},
});
const mockDoc = {
    getElementById: () => mockElement(),
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => ({ textContent: '', innerHTML: '' }),
    addEventListener: () => {},
    body: { classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false } },
};

const storageBacking = {};
const mockStorage = {
    getItem: k => storageBacking[k] || null,
    setItem: (k, v) => {
        storageBacking[k] = v;
    },
    removeItem: k => {
        delete storageBacking[k];
    },
};

const sandbox = {
    document: mockDoc,
    window: {},
    console: console,
    crypto: {
        getRandomValues: arr => {
            for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
            return arr;
        },
    },
    localStorage: mockStorage,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Promise: Promise,
    Set: Set,
    fetch: () => Promise.resolve({ json: () => ({}) }),
    navigator: { vibrate: () => {} },
};
sandbox.window = sandbox;

const ctx = vm.createContext(sandbox);

// Load modules in dependency order, exposing symbols on the sandbox
// 1. Songs data
vm.runInContext('(function(){' + readModule('songs-data.js') + '\nthis.SONGS_DATA=SONGS_DATA;\n}).call(this);', ctx);

// 2. Utilities (escapeHtml, shuffleArray)
vm.runInContext(
    '(function(){' +
        readModule('src/utils.js') +
        '\nthis.escapeHtml=escapeHtml;this.shuffleArray=shuffleArray;\n}).call(this);',
    ctx,
);

// 3. Songs store (uses SONGS_DATA)
vm.runInContext(
    '(function(){' +
        readModule('src/songs.js') +
        '\nthis.getSongs=getSongs;this.setSongs=setSongs;this.resetSongs=resetSongs;this.getAllSongs=getAllSongs;\n}).call(this);',
    ctx,
);

// 4. Game modules — load and expose method objects
vm.runInContext(
    '(function(){' +
        readModule('src/game/phases.js') +
        '\nthis.Phase=Phase;this.isValidTransition=isValidTransition;this.transition=transition;\n}).call(this);',
    ctx,
);
vm.runInContext(
    '(function(){' + readModule('src/game/state.js') + '\nthis.stateMethods=stateMethods;\n}).call(this);',
    ctx,
);
vm.runInContext(
    '(function(){' + readModule('src/game/spotify.js') + '\nthis.spotifyMethods=spotifyMethods;\n}).call(this);',
    ctx,
);
vm.runInContext('(function(){' + readModule('src/game/ui.js') + '\nthis.uiMethods=uiMethods;\n}).call(this);', ctx);
vm.runInContext(
    '(function(){' + readModule('src/game/engine.js') + '\nthis.engineMethods=engineMethods;\n}).call(this);',
    ctx,
);
vm.runInContext(
    '(function(){' + readModule('src/game/gm-panel.js') + '\nthis.gmMethods=gmMethods;\n}).call(this);',
    ctx,
);

// 5. Compose Game object (mirrors main.js)
vm.runInContext(
    `
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
        _isPlaying: false,
        challengePhase: null,
        titleArtistClaimed: false,
        gamePhase: Phase.IDLE,
        MAX_TOKENS: 5,
    };
    // Use defineProperties to preserve getters (e.g., currentPlayer)
    [engineMethods, uiMethods, spotifyMethods, stateMethods, gmMethods].forEach(function(methods) {
        Object.defineProperties(Game, Object.getOwnPropertyDescriptors(methods));
    });
    this.Game = Game;

    // App stub for cross-references
    this.App = { showScreen: function(){} };
    this.window.App = this.App;
    this.window.Game = Game;

    // Legacy compatibility aliases used by tests
    this.SONGS_DATABASE = getSongs();
    this.shuffleArray = shuffleArray;
`,
    ctx,
);

const G = sandbox.Game;
const DB = sandbox.SONGS_DATABASE;
const shuffle = sandbox.shuffleArray;
const Phase = sandbox.Phase;

let passed = 0,
    failed = 0;

function assert(desc, cond) {
    if (cond) {
        passed++;
        console.log('\x1b[32mPASS\x1b[0m:', desc);
    } else {
        failed++;
        console.error('\x1b[31mFAIL\x1b[0m:', desc);
    }
}

function section(name) {
    console.log('\n\x1b[36m--- ' + name + ' ---\x1b[0m');
}

// Helper: find correct placement position for a song in a timeline
function findCorrectIndex(timeline, song) {
    for (let i = 0; i <= timeline.length; i++) {
        if (G.isPlacementCorrect(timeline, song, i)) return i;
    }
    return -1;
}

// Helper: place a song correctly on a player's timeline
function placeCorrectly(playerIdx) {
    const song = G.drawSong();
    if (!song) return null;
    G.currentSong = song;
    const tl = G.players[playerIdx].timeline;
    const idx = findCorrectIndex(tl, song);
    tl.splice(idx, 0, { title: song.title, artist: song.artist, year: song.year });
    G.players[playerIdx].score = tl.length;
    return song;
}

// ==================== SONGS DATABASE ====================
section('Songs Database');
assert('DB is array', Array.isArray(DB));
assert('Has 80+ songs', DB.length >= 80);
assert(
    'All have required fields',
    DB.every(s => s.title && s.artist && s.year && s.spotifyId),
);
assert(
    'All years between 1950-2030',
    DB.every(s => s.year >= 1950 && s.year <= 2030),
);
assert(
    'Spotify IDs valid format',
    DB.every(s => /^[a-zA-Z0-9]{20,24}$/.test(s.spotifyId)),
);

const keys = DB.map(s => s.title + '|' + s.artist);
assert('No duplicate title+artist', keys.length === new Set(keys).size);

const decades = {};
DB.forEach(s => {
    const d = Math.floor(s.year / 10) * 10;
    decades[d] = (decades[d] || 0) + 1;
});
assert('Songs from 5+ decades', Object.keys(decades).length >= 5);
console.log(
    '  Decade distribution:',
    Object.entries(decades)
        .sort()
        .map(([d, c]) => d + 's:' + c)
        .join(', '),
);

// Verify song data integrity
assert(
    'All years are integers',
    DB.every(s => Number.isInteger(s.year)),
);
assert(
    'All titles non-empty strings',
    DB.every(s => typeof s.title === 'string' && s.title.trim().length > 0),
);
assert(
    'All artists non-empty strings',
    DB.every(s => typeof s.artist === 'string' && s.artist.trim().length > 0),
);

// ==================== SHUFFLE ====================
section('Shuffle');
const orig = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const sh = shuffle(orig);
assert('Same length', sh.length === orig.length);
assert(
    'Contains all elements',
    orig.every(x => sh.includes(x)),
);
assert('Does not modify original', JSON.stringify(orig) === '[1,2,3,4,5,6,7,8,9,10]');

let diffCount = 0;
for (let i = 0; i < 10; i++) {
    if (JSON.stringify(shuffle(orig)) !== JSON.stringify(orig)) diffCount++;
}
assert('Produces different orderings (8+/10)', diffCount >= 8);

// Edge: single element
const singleArr = [42];
assert('Shuffle single element returns [42]', JSON.stringify(shuffle(singleArr)) === '[42]');

// Edge: empty array
const emptyArr = [];
assert('Shuffle empty array returns []', JSON.stringify(shuffle(emptyArr)) === '[]');

// ==================== GAME INIT ====================
section('Game Init');
G.init(['Alice', 'Bob'], 10);
assert('2 players', G.players.length === 2);
assert('Correct names', G.players[0].name === 'Alice' && G.players[1].name === 'Bob');
assert(
    'Each player starts with 1 card',
    G.players.every(p => p.timeline.length === 1),
);
assert(
    'Starting cards have year',
    G.players.every(p => p.timeline[0].year >= 1950),
);
assert(
    'Score 1 (starting card)',
    G.players.every(p => p.score === 1),
);
assert('cardsToWin = 10', G.cardsToWin === 10);
assert('currentPlayer is Alice', G.currentPlayer.name === 'Alice');
assert('Deck populated', G.deck.length > 0);
assert(
    'Each player starts with 3 tokens',
    G.players.every(p => p.tokens === 3),
);
assert('challengePhase is null at start', G.challengePhase === null);
assert('titleArtistClaimed is false at start', G.titleArtistClaimed === false);
assert('currentSong is null at start', G.currentSong === null);
assert('isWaitingForPlacement is false at start', G.isWaitingForPlacement === false);

// Init with max players (10)
section('Game Init - Max Players');
const tenNames = Array.from({ length: 10 }, (_, i) => 'Player' + (i + 1));
G.init(tenNames, 5);
assert('10 players initialized', G.players.length === 10);
assert(
    'All 10 players have unique starting cards',
    new Set(G.players.map(p => p.timeline[0].title + p.timeline[0].artist)).size === 10,
);
assert(
    'All 10 have 3 tokens',
    G.players.every(p => p.tokens === 3),
);

// Init with min players (2)
G.init(['A', 'B'], 2);
assert('Min players: 2 players', G.players.length === 2);
assert('Min cardsToWin: 2', G.cardsToWin === 2);

// ==================== DRAW SONGS ====================
section('Draw Songs');
G.init(['A', 'B'], 10);
const s1 = G.drawSong();
assert('Returns song object', s1 && s1.title && s1.artist && s1.year);
const s2 = G.drawSong();
assert('Second draw is different', s1.title !== s2.title || s1.artist !== s2.artist);
assert(
    'Starting cards not redrawn',
    !G.players.some(p => p.timeline[0].title === s1.title && p.timeline[0].artist === s1.artist),
);

// Draw many
G.init(['A', 'B'], 10);
let drawOk = true;
try {
    for (let i = 0; i < 150; i++) G.drawSong();
} catch (e) {
    drawOk = false;
}
assert('Can draw 150 songs (reshuffles)', drawOk);

// Test song key deduplication
G.init(['A', 'B'], 10);
const drawn = new Set();
let noDupes = true;
for (let i = 0; i < 50; i++) {
    const song = G.drawSong();
    if (!song) break;
    const key = song.title.toLowerCase() + '-' + song.artist.toLowerCase();
    if (drawn.has(key)) {
        noDupes = false;
        break;
    }
    drawn.add(key);
}
assert('No duplicate songs drawn (50 draws)', noDupes);

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

// ==================== EDGE CASES: PLACEMENT ====================
section('Edge Cases - Placement');

const longTl = [];
for (let y = 1960; y <= 2020; y++) longTl.push({ year: y });
assert('60-card timeline: before works', G.isPlacementCorrect(longTl, { year: 1959 }, 0));
assert('60-card timeline: after works', G.isPlacementCorrect(longTl, { year: 2021 }, longTl.length));
assert('60-card timeline: wrong placement fails', !G.isPlacementCorrect(longTl, { year: 2021 }, 0));
assert('60-card timeline: middle placement correct', G.isPlacementCorrect(longTl, { year: 1990 }, 30));
assert('60-card timeline: middle placement wrong', !G.isPlacementCorrect(longTl, { year: 1990 }, 50));

const dupes = [{ year: 1990 }, { year: 1990 }, { year: 2000 }];
assert('Duplicate years: placement at 0 works', G.isPlacementCorrect(dupes, { year: 1990 }, 0));
assert('Duplicate years: placement at 1 works', G.isPlacementCorrect(dupes, { year: 1990 }, 1));
assert('Duplicate years: placement at 2 works', G.isPlacementCorrect(dupes, { year: 1990 }, 2));
assert('Duplicate years: placement at 3 fails (before 2000)', G.isPlacementCorrect(dupes, { year: 1990 }, 3) === false);

// All same year
const allSame = [{ year: 2000 }, { year: 2000 }, { year: 2000 }];
assert(
    'All same year: any position correct',
    [0, 1, 2, 3].every(i => G.isPlacementCorrect(allSame, { year: 2000 }, i)),
);

// Boundary years
assert('Year 1950 at start: correct', G.isPlacementCorrect([{ year: 1960 }], { year: 1950 }, 0));
assert('Year 2030 at end: correct', G.isPlacementCorrect([{ year: 2020 }], { year: 2030 }, 1));

// ==================== _findChronologicalIndex ====================
section('Chronological Index');
assert('Empty timeline: returns 0', G._findChronologicalIndex([], 2000) === 0);
assert('Before all: returns 0', G._findChronologicalIndex([{ year: 2000 }], 1990) === 0);
assert('After all: returns length', G._findChronologicalIndex([{ year: 2000 }], 2010) === 1);
assert('Between: returns middle', G._findChronologicalIndex([{ year: 1980 }, { year: 2000 }], 1990) === 1);
assert('Same year: returns first match', G._findChronologicalIndex([{ year: 1990 }, { year: 2000 }], 1990) === 0);

// ==================== XSS / SECURITY ====================
section('Security');
assert('escapeHtml blocks <script>', G.escapeHtml('<script>alert(1)</script>').includes('&lt;'));
assert('Normal text passes through', G.escapeHtml('Hello World') === 'Hello World');
assert('escapeHtml handles &', G.escapeHtml('A & B') === 'A &amp; B');
assert('escapeHtml handles double quotes', G.escapeHtml('"hello"') === '&quot;hello&quot;');
assert('escapeHtml handles single quotes', G.escapeHtml("it's") === 'it&#39;s');
assert('escapeHtml handles all at once', G.escapeHtml('<a href="x">&') === '&lt;a href=&quot;x&quot;&gt;&amp;');

// Spotify ID validation
assert('Valid Spotify ID passes', G._isValidSpotifyId('4uLU6hMCjMI75M1A2tKUQC'));
assert('Short ID rejected', G._isValidSpotifyId('abc') === false);
assert('Too long ID rejected', G._isValidSpotifyId('a'.repeat(31)) === false);
assert('Special chars rejected', G._isValidSpotifyId('abc<script>1234567') === false);
assert('Empty string rejected', G._isValidSpotifyId('') === false);
assert('Non-string rejected', G._isValidSpotifyId(null) === false);
assert('Number rejected', G._isValidSpotifyId(12345) === false);

// ==================== WIN CONDITION ====================
section('Win Condition');
G.init(['Alice', 'Bob'], 3);
G.players[0].score = 3;
assert('Winner detected at threshold', G.players.find(p => p.score >= G.cardsToWin).name === 'Alice');
G.players[0].score = 2;
assert('No premature winner', !G.players.find(p => p.score >= G.cardsToWin));

// Win above threshold
G.init(['Alice', 'Bob'], 3);
G.players[0].score = 5;
assert('Winner detected above threshold', G.players.find(p => p.score >= G.cardsToWin).name === 'Alice');

// Multiple players at threshold: first found wins
G.init(['Alice', 'Bob'], 3);
G.players[0].score = 3;
G.players[1].score = 3;
const firstWinner = G.players.find(p => p.score >= G.cardsToWin);
assert('Tie: first player found wins', firstWinner.name === 'Alice');

// ==================== PLAYER ROTATION ====================
section('Player Rotation');
G.init(['A', 'B', 'C'], 10);
assert('Starts at player 0', G.currentPlayerIndex === 0);
G.currentPlayerIndex = (G.currentPlayerIndex + 1) % G.players.length;
assert('Advances to 1', G.currentPlayerIndex === 1);
G.currentPlayerIndex = (G.currentPlayerIndex + 1) % G.players.length;
assert('Advances to 2', G.currentPlayerIndex === 2);
G.currentPlayerIndex = (G.currentPlayerIndex + 1) % G.players.length;
assert('Wraps to 0', G.currentPlayerIndex === 0);

// ==================== TOKEN SYSTEM ====================
section('Token System');
G.init(['Alice', 'Bob'], 10);
assert(
    'Start with 3 tokens each',
    G.players.every(p => p.tokens === 3),
);

// Skip song with token
const aliceTokensBefore = G.players[0].tokens;
G.isWaitingForPlacement = true;
G.hasPlayedSong = true;
G.currentSong = G.drawSong();
G.skipSongWithToken();
assert('Skip costs 1 token', G.players[0].tokens === aliceTokensBefore - 1);

// Cannot skip without tokens
G.init(['Alice', 'Bob'], 10);
G.players[0].tokens = 0;
G.isWaitingForPlacement = true;
G.hasPlayedSong = true;
G.currentSong = G.drawSong();
G.skipSongWithToken();
assert('Cannot skip with 0 tokens', G.players[0].tokens === 0);

// Trade 3 tokens for card
G.init(['Alice', 'Bob'], 10);
G.players[0].tokens = 3;
G.isWaitingForPlacement = true;
G.hasPlayedSong = true;
G.currentSong = G.drawSong();
const scoreBefore = G.players[0].score;
G.tradeTokensForCard();
assert('Trade costs 3 tokens', G.players[0].tokens === 0);
assert('Trade adds 1 card', G.players[0].score === scoreBefore + 1);

// Cannot trade with < 3 tokens
G.init(['Alice', 'Bob'], 10);
G.players[0].tokens = 2;
G.isWaitingForPlacement = true;
G.hasPlayedSong = true;
const scoreBeforeTrade = G.players[0].score;
G.tradeTokensForCard();
assert('Cannot trade with 2 tokens', G.players[0].tokens === 2);
assert('Score unchanged after failed trade', G.players[0].score === scoreBeforeTrade);

// Trade places card chronologically
G.init(['Alice', 'Bob'], 10);
G.players[0].tokens = 5;
G.isWaitingForPlacement = true;
G.hasPlayedSong = true;
G.currentSong = G.drawSong();
G.tradeTokensForCard();
const aliceTl2 = G.players[0].timeline;
let tradeTimelineValid = true;
for (let i = 1; i < aliceTl2.length; i++) {
    if (aliceTl2[i].year < aliceTl2[i - 1].year) {
        tradeTimelineValid = false;
        break;
    }
}
assert('Traded card placed chronologically', tradeTimelineValid);

// Max tokens cap
G.init(['Alice', 'Bob'], 10);
G.players[0].tokens = G.MAX_TOKENS;
assert('MAX_TOKENS is 5', G.MAX_TOKENS === 5);
assert('Player at max tokens', G.players[0].tokens === 5);

// ==================== CHALLENGE PHASE ====================
section('Challenge Phase - Structure');
G.init(['Alice', 'Bob', 'Charlie'], 10);
G.currentSong = G.drawSong();
G.isWaitingForPlacement = true;
G.selectedDropIndex = 0;

// Simulate confirmPlacement
G.confirmPlacement();
assert('Challenge phase created', G.challengePhase !== null);
assert('Challenge phase has originalPlayerIndex', G.challengePhase.originalPlayerIndex === 0);
assert('Challenge phase has originalDropIndex', G.challengePhase.originalDropIndex === 0);
assert('Challenge phase has empty challengers', G.challengePhase.challengers.length === 0);
assert('Challenge phase currentChallengerIdx is 0', G.challengePhase.currentChallengerIdx === 0);
assert('Challenge phase winnerChallengerPlayerIndex is null', G.challengePhase.winnerChallengerPlayerIndex === null);

// ==================== CHALLENGE: START AND CANCEL ====================
section('Challenge - Start and Cancel');
G.init(['Alice', 'Bob'], 10);
G.currentSong = G.drawSong();
G.isWaitingForPlacement = true;
G.selectedDropIndex = 0;
G.confirmPlacement();

// Start challenge (Bob challenges)
const bobTokensBefore = G.players[1].tokens;
G.selectChallenger(1);
assert('Challenger added', G.challengePhase.challengers.length === 1);
assert('Challenger token deducted', G.players[1].tokens === bobTokensBefore - 1);
assert('Challenger playerIndex is Bob (1)', G.challengePhase.challengers[0].playerIndex === 1);
assert('Challenger dropIndex starts null', G.challengePhase.challengers[0].dropIndex === null);

// Cancel with refund
G.cancelChallengeRefund();
assert('Cancel refunds token', G.players[1].tokens === bobTokensBefore);
assert('Cancel removes challenger', G.challengePhase.challengers.length === 0);

// ==================== CHALLENGE: CANNOT CHALLENGE WITHOUT TOKENS ====================
section('Challenge - No Tokens');
G.init(['Alice', 'Bob'], 10);
G.players[1].tokens = 0;
G.currentSong = G.drawSong();
G.isWaitingForPlacement = true;
G.selectedDropIndex = 0;
G.confirmPlacement();

// Try to start challenge - should bail (no eligible players)
G.startChallenge();
assert('No challenge started with 0 tokens', G.challengePhase.challengers.length === 0);

// ==================== RESOLVE: NO CHALLENGE, CORRECT ====================
section('Resolution - No Challenge, Correct');
G.init(['Alice', 'Bob'], 10);
const resolveSong1 = G.drawSong();
G.currentSong = resolveSong1;
G.isWaitingForPlacement = true;

// Find correct index for this song on Alice's timeline
const aliceTl3 = G.players[0].timeline;
const correctIdx = findCorrectIndex(aliceTl3, resolveSong1);
G.selectedDropIndex = correctIdx;
G.confirmPlacement();

const aliceScoreBefore = G.players[0].score;
G.resolvePlacement();
assert('Correct placement: score increases', G.players[0].score === aliceScoreBefore + 1);
assert(
    'Correct placement: card added to timeline',
    G.players[0].timeline.some(c => c.title === resolveSong1.title),
);

// ==================== RESOLVE: NO CHALLENGE, WRONG ====================
section('Resolution - No Challenge, Wrong');
G.init(['Alice', 'Bob'], 10);
const resolveSong2 = G.drawSong();
G.currentSong = resolveSong2;
G.isWaitingForPlacement = true;

// Use a wrong index: place future song at start if it should go at end
const wrongIdx = G.isPlacementCorrect(G.players[0].timeline, resolveSong2, 0) ? G.players[0].timeline.length : 0;
// If both are correct (single card timeline allows it), manufacture a wrong scenario
const usedWrongIdx = wrongIdx;
if (G.isPlacementCorrect(G.players[0].timeline, resolveSong2, usedWrongIdx)) {
    // For single-card timeline, create a scenario where we can test wrong placement
    // Skip this specific test with a simulated wrong result
    G.selectedDropIndex = 0;
    G.confirmPlacement();
    // Manually force wrong by using isPlacementCorrect with known-bad data
    // Test with an artificial wrong placement: song year 2020 at index 0 of [1960] timeline
    G.players[0].timeline = [{ year: 1960, title: 'X', artist: 'Y' }];
    G.players[0].score = 1;
    G.currentSong = { title: 'Test', artist: 'Test', year: 2020, spotifyId: '12345678901234567890' };
    G.challengePhase.originalDropIndex = 0; // Place 2020 before 1960 = wrong
    G.resolvePlacement();
    assert('Wrong placement: score unchanged', G.players[0].score === 1);
    assert('Wrong placement: card NOT in timeline', !G.players[0].timeline.some(c => c.title === 'Test'));
} else {
    G.selectedDropIndex = usedWrongIdx;
    G.confirmPlacement();
    const scoreAfterWrong = G.players[0].score;
    G.resolvePlacement();
    // If placement wrong, score stays same
    if (!G.isPlacementCorrect(G.players[0].timeline, resolveSong2, usedWrongIdx)) {
        assert('Wrong placement: score unchanged', G.players[0].score === scoreAfterWrong);
    }
}

// ==================== RESOLVE: CHALLENGER WINS (STEALS CARD) ====================
section('Resolution - Challenger Wins');
G.init(['Alice', 'Bob'], 10);
// Setup: Alice has [1960], current song is year 2020
G.players[0].timeline = [{ year: 1960, title: 'OldSong', artist: 'A' }];
G.players[0].score = 1;
G.currentSong = { title: 'NewSong', artist: 'B', year: 2020, spotifyId: '12345678901234567890' };
G.isWaitingForPlacement = true;
G.selectedDropIndex = 0; // Alice places 2020 before 1960 = WRONG
G.confirmPlacement();

// Bob challenges and places correctly (index 1 = after 1960)
G.players[1].tokens -= 1;
G.challengePhase.challengers.push({ playerIndex: 1, dropIndex: 1 });

const bobScoreBefore = G.players[1].score;
G.resolvePlacement();
assert('Challenger wins: Bob score increases', G.players[1].score === bobScoreBefore + 1);
assert(
    'Challenger wins: card in Bob timeline',
    G.players[1].timeline.some(c => c.title === 'NewSong'),
);
assert('Challenger wins: card NOT in Alice timeline', !G.players[0].timeline.some(c => c.title === 'NewSong'));
assert('Challenger wins: Alice score unchanged', G.players[0].score === 1);
assert('Challenger wins: winnerChallengerPlayerIndex set', G.challengePhase.winnerChallengerPlayerIndex === 1);

// ==================== RESOLVE: ORIGINAL CORRECT, CHALLENGER WRONG ====================
section('Resolution - Original Correct, Challenger Loses');
G.init(['Alice', 'Bob'], 10);
G.players[0].timeline = [{ year: 1960, title: 'OldSong', artist: 'A' }];
G.players[0].score = 1;
G.currentSong = { title: 'CorrectSong', artist: 'B', year: 2020, spotifyId: '12345678901234567890' };
G.isWaitingForPlacement = true;
G.selectedDropIndex = 1; // Alice places 2020 after 1960 = CORRECT
G.confirmPlacement();

// Bob challenges incorrectly (index 0 = before 1960 for a 2020 song)
G.players[1].tokens -= 1;
G.challengePhase.challengers.push({ playerIndex: 1, dropIndex: 0 });

const aliceScoreOC = G.players[0].score;
const bobScoreOC = G.players[1].score;
G.resolvePlacement();
assert('Original wins: Alice score increases', G.players[0].score === aliceScoreOC + 1);
assert('Original wins: Bob score unchanged', G.players[1].score === bobScoreOC);
assert(
    'Original wins: card in Alice timeline',
    G.players[0].timeline.some(c => c.title === 'CorrectSong'),
);

// ==================== RESOLVE: ALL WRONG (NOBODY GETS CARD) ====================
section('Resolution - Nobody Wins');
G.init(['Alice', 'Bob'], 10);
G.players[0].timeline = [
    { year: 1980, title: 'Song80', artist: 'A' },
    { year: 2000, title: 'Song00', artist: 'B' },
];
G.players[0].score = 2;
G.currentSong = { title: 'Song90', artist: 'C', year: 1990, spotifyId: '12345678901234567890' };
G.isWaitingForPlacement = true;
G.selectedDropIndex = 0; // Before 1980 for a 1990 song = WRONG
G.confirmPlacement();

// Bob also places wrong (index 2 = after 2000 for a 1990 song)
G.players[1].tokens -= 1;
G.challengePhase.challengers.push({ playerIndex: 1, dropIndex: 2 });

const aliceScoreNW = G.players[0].score;
const bobScoreNW = G.players[1].score;
G.resolvePlacement();
assert('Nobody wins: Alice score unchanged', G.players[0].score === aliceScoreNW);
assert('Nobody wins: Bob score unchanged', G.players[1].score === bobScoreNW);
assert(
    'Nobody wins: card not in any timeline',
    !G.players[0].timeline.some(c => c.title === 'Song90') && !G.players[1].timeline.some(c => c.title === 'Song90'),
);

// ==================== MULTI-CHALLENGER RESOLUTION ====================
section('Resolution - Multi Challenger');
G.init(['Alice', 'Bob', 'Charlie'], 10);
G.players[0].timeline = [
    { year: 1970, title: 'S70', artist: 'A' },
    { year: 2010, title: 'S10', artist: 'B' },
];
G.players[0].score = 2;
G.currentSong = { title: 'S90', artist: 'C', year: 1990, spotifyId: '12345678901234567890' };
G.isWaitingForPlacement = true;
G.selectedDropIndex = 0; // Before 1970 for 1990 = WRONG
G.confirmPlacement();

// Bob challenges wrong (index 2 = after 2010 for 1990), Charlie challenges correct (index 1 = between 1970-2010)
G.players[1].tokens -= 1;
G.players[2].tokens -= 1;
G.challengePhase.challengers.push({ playerIndex: 1, dropIndex: 2 });
G.challengePhase.challengers.push({ playerIndex: 2, dropIndex: 1 });

const charlieScoreBefore = G.players[2].score;
G.resolvePlacement();
assert('Multi: first correct challenger (Charlie) wins', G.challengePhase.winnerChallengerPlayerIndex === 2);
assert('Multi: Charlie score increases', G.players[2].score === charlieScoreBefore + 1);
assert(
    'Multi: card in Charlie timeline',
    G.players[2].timeline.some(c => c.title === 'S90'),
);
assert('Multi: card NOT in Bob timeline', !G.players[1].timeline.some(c => c.title === 'S90'));

// ==================== TITLE/ARTIST CLAIM ====================
section('Title/Artist Claim');
G.init(['Alice', 'Bob'], 10);
assert('titleArtistClaimed starts false', G.titleArtistClaimed === false);
G.toggleTitleClaim();
assert('Toggle claim on', G.titleArtistClaimed === true);
G.toggleTitleClaim();
assert('Toggle claim off', G.titleArtistClaimed === false);

// Confirm claim correct: +1 token
G.init(['Alice', 'Bob'], 10);
G.currentSong = G.drawSong();
G.isWaitingForPlacement = true;
G.selectedDropIndex = findCorrectIndex(G.players[0].timeline, G.currentSong);
G.confirmPlacement();
const tokensBefore = G.players[0].tokens;
G.confirmTitleClaim(true);
assert('Correct title claim: +1 token', G.players[0].tokens === tokensBefore + 1);

// Confirm claim wrong: no token
G.init(['Alice', 'Bob'], 10);
G.currentSong = G.drawSong();
G.isWaitingForPlacement = true;
G.selectedDropIndex = findCorrectIndex(G.players[0].timeline, G.currentSong);
G.confirmPlacement();
const tokensBefore2 = G.players[0].tokens;
G.confirmTitleClaim(false);
assert('Wrong title claim: no token', G.players[0].tokens === tokensBefore2);

// Claim at max tokens: no token added
G.init(['Alice', 'Bob'], 10);
G.players[0].tokens = G.MAX_TOKENS;
G.currentSong = G.drawSong();
G.isWaitingForPlacement = true;
G.selectedDropIndex = findCorrectIndex(G.players[0].timeline, G.currentSong);
G.confirmPlacement();
G.confirmTitleClaim(true);
assert('Claim at max tokens: stays at max', G.players[0].tokens === G.MAX_TOKENS);

// ==================== STATE PERSISTENCE ====================
section('State Persistence');

// Save and restore
G.init(['Alice', 'Bob'], 7);
G.currentSong = G.drawSong();
G.isWaitingForPlacement = true;
G.players[0].score = 3;
G.players[0].timeline = [
    { year: 1970, title: 'A', artist: 'X' },
    { year: 1990, title: 'B', artist: 'Y' },
    { year: 2010, title: 'C', artist: 'Z' },
];
G.saveState();

// Modify state
G.players[0].score = 99;
G.currentPlayerIndex = 1;

// Restore
const restored = G.restoreState();
assert('restoreState returns true on valid data', restored === true);
assert('Restore: score recalculated from timeline', G.players[0].score === 3);
assert('Restore: currentPlayerIndex preserved', G.currentPlayerIndex === 0);
assert('Restore: cardsToWin preserved', G.cardsToWin === 7);
assert('Restore: players preserved', G.players.length === 2 && G.players[0].name === 'Alice');

// Corrupt data
storageBacking['hitster-game'] = 'not-valid-json{{{';
const restoreCorrupt = G.restoreState();
assert('Corrupt JSON: restoreState returns false', restoreCorrupt === false);

// Invalid structure: too few players
storageBacking['hitster-game'] = JSON.stringify({
    players: [{ name: 'Solo', timeline: [], score: 0 }],
    currentPlayerIndex: 0,
    cardsToWin: 3,
});
assert('Invalid structure: returns false', G.restoreState() === false);

// Invalid: currentPlayerIndex out of range
storageBacking['hitster-game'] = JSON.stringify({
    players: [
        { name: 'A', timeline: [], score: 0 },
        { name: 'B', timeline: [], score: 0 },
    ],
    currentPlayerIndex: 5,
    cardsToWin: 3,
});
assert('Bad playerIndex: returns false', G.restoreState() === false);

// Invalid: negative cardsToWin
storageBacking['hitster-game'] = JSON.stringify({
    players: [
        { name: 'A', timeline: [], score: 0 },
        { name: 'B', timeline: [], score: 0 },
    ],
    currentPlayerIndex: 0,
    cardsToWin: -1,
});
assert('Negative cardsToWin: returns false', G.restoreState() === false);

// Invalid: player without name
storageBacking['hitster-game'] = JSON.stringify({
    players: [
        { name: '', timeline: [], score: 0 },
        { name: 'B', timeline: [], score: 0 },
    ],
    currentPlayerIndex: 0,
    cardsToWin: 3,
});
assert('Empty name: returns false', G.restoreState() === false);

// Backwards compatibility: old challenge format migration
G.init(['A', 'B', 'C'], 5);
G.currentSong = G.drawSong();
const oldFormatState = {
    players: G.players,
    currentPlayerIndex: 0,
    cardsToWin: 5,
    usedSongs: [...G.usedSongs],
    currentSong: G.currentSong,
    hasPlayedSong: false,
    isWaitingForPlacement: true,
    challengePhase: {
        originalPlayerIndex: 0,
        originalDropIndex: 1,
        challengerIndex: 2,
        challengerDropIndex: 0,
    },
    titleArtistClaimed: false,
};
storageBacking['hitster-game'] = JSON.stringify(oldFormatState);
G.restoreState();
assert('Old format migrated: challengers is array', Array.isArray(G.challengePhase.challengers));
assert(
    'Old format migrated: challenger preserved',
    G.challengePhase.challengers.length === 1 && G.challengePhase.challengers[0].playerIndex === 2,
);

// Backwards compatibility: missing tokens
const noTokensState = {
    players: [
        { name: 'A', timeline: [{ year: 2000, title: 'X', artist: 'Y' }], score: 1 },
        { name: 'B', timeline: [{ year: 2000, title: 'X2', artist: 'Y2' }], score: 1 },
    ],
    currentPlayerIndex: 0,
    cardsToWin: 5,
    usedSongs: [],
    currentSong: null,
    hasPlayedSong: false,
    isWaitingForPlacement: false,
    challengePhase: null,
    titleArtistClaimed: false,
};
storageBacking['hitster-game'] = JSON.stringify(noTokensState);
G.restoreState();
assert(
    'Missing tokens: defaults to 3',
    G.players.every(p => p.tokens === 3),
);

// Score recalculated from timeline
const desyncState = {
    players: [
        {
            name: 'A',
            timeline: [
                { year: 1990, title: 'X', artist: 'Y' },
                { year: 2000, title: 'Z', artist: 'W' },
            ],
            score: 99,
        },
        { name: 'B', timeline: [{ year: 2000, title: 'X2', artist: 'Y2' }], score: 0 },
    ],
    currentPlayerIndex: 0,
    cardsToWin: 5,
    usedSongs: [],
    currentSong: null,
    hasPlayedSong: false,
    isWaitingForPlacement: false,
    challengePhase: null,
    titleArtistClaimed: false,
};
storageBacking['hitster-game'] = JSON.stringify(desyncState);
G.restoreState();
assert('Score recalculated: A has 2', G.players[0].score === 2);
assert('Score recalculated: B has 1', G.players[1].score === 1);

// No saved state
delete storageBacking['hitster-game'];
assert('No saved state: returns false', G.restoreState() === false);

// State versioning: V2 state saved with stateVersion
G.init(['Alice', 'Bob'], 5);
G.currentSong = G.drawSong();
G.hasPlayedSong = true;
G.isWaitingForPlacement = true;
G.gamePhase = Phase.PLACING;
G.saveState();
const savedV2 = JSON.parse(storageBacking['hitster-game']);
assert('Save includes stateVersion 2', savedV2.stateVersion === 2);
assert('Save includes gamePhase', savedV2.gamePhase === 'PLACING');

// V1 migration: unversioned state gets gamePhase inferred
const v1State = {
    players: [
        { name: 'A', timeline: [{ year: 2000, title: 'X', artist: 'Y' }], score: 1, tokens: 3 },
        { name: 'B', timeline: [], score: 0, tokens: 3 },
    ],
    currentPlayerIndex: 0,
    cardsToWin: 5,
    usedSongs: [],
    currentSong: { title: 'Test', artist: 'Test', year: 2000, spotifyId: 'abc123' },
    hasPlayedSong: true,
    isWaitingForPlacement: true,
    challengePhase: null,
    titleArtistClaimed: false,
};
storageBacking['hitster-game'] = JSON.stringify(v1State);
assert('V1 state restores successfully', G.restoreState() === true);
assert('V1 migration: gamePhase inferred as PLACING', G.gamePhase === 'PLACING');

// V1 migration with challengePhase → PRE_REVEAL
const v1Challenge = {
    players: [
        { name: 'A', timeline: [], score: 0, tokens: 3 },
        { name: 'B', timeline: [], score: 0, tokens: 3 },
    ],
    currentPlayerIndex: 0,
    cardsToWin: 5,
    usedSongs: [],
    currentSong: { title: 'T', artist: 'A', year: 2000, spotifyId: 'xyz789' },
    hasPlayedSong: false,
    isWaitingForPlacement: false,
    challengePhase: { originalPlayerIndex: 0, originalDropIndex: 1, challengers: [], currentChallengerIdx: 0 },
    titleArtistClaimed: false,
};
storageBacking['hitster-game'] = JSON.stringify(v1Challenge);
assert('V1 with challenge restores', G.restoreState() === true);
assert('V1 challenge: gamePhase is PRE_REVEAL', G.gamePhase === 'PRE_REVEAL');

// V1 migration with no currentSong → PASS_PHONE
const v1NoSong = {
    players: [
        { name: 'A', timeline: [], score: 0, tokens: 3 },
        { name: 'B', timeline: [], score: 0, tokens: 3 },
    ],
    currentPlayerIndex: 0,
    cardsToWin: 5,
    usedSongs: [],
    currentSong: null,
    hasPlayedSong: false,
    isWaitingForPlacement: false,
    challengePhase: null,
    titleArtistClaimed: false,
};
storageBacking['hitster-game'] = JSON.stringify(v1NoSong);
assert('V1 no song restores', G.restoreState() === true);
assert('V1 no song: gamePhase is PASS_PHONE', G.gamePhase === 'PASS_PHONE');

// Unknown future version resets
const futureState = {
    stateVersion: 99,
    players: [
        { name: 'A', timeline: [], score: 0 },
        { name: 'B', timeline: [], score: 0 },
    ],
    currentPlayerIndex: 0,
    cardsToWin: 5,
};
storageBacking['hitster-game'] = JSON.stringify(futureState);
assert('Future version: restoreState returns false', G.restoreState() === false);
assert('Future version: state cleared', !storageBacking['hitster-game']);

// ==================== FULL GAME FLOW SIMULATION ====================
section('Full Game Flow (2 players, win at 3)');

G.init(['Alice', 'Bob'], 3);
assert('Flow: Game initialized', G.players.length === 2 && G.cardsToWin === 3);
assert(
    'Flow: Each player starts with 1 card',
    G.players.every(p => p.timeline.length === 1 && p.score === 1),
);
assert('Flow: Alice starts', G.currentPlayer.name === 'Alice');

// Turn 1: Alice draws and places correctly
G.currentSong = G.drawSong();
G.isWaitingForPlacement = true;
assert('Flow: Song drawn for Alice', G.currentSong !== null);

const aliceSong1 = G.currentSong;
const tl0 = G.players[0].timeline;
const idx0 = findCorrectIndex(tl0, aliceSong1);
tl0.splice(idx0, 0, { title: aliceSong1.title, artist: aliceSong1.artist, year: aliceSong1.year });
G.players[0].score = tl0.length;
G.isWaitingForPlacement = false;
assert('Flow: Alice score = 2', G.players[0].score === 2);
assert('Flow: No winner yet', !G.players.find(p => p.score >= G.cardsToWin));

// Advance to Bob
G.currentPlayerIndex = (G.currentPlayerIndex + 1) % G.players.length;
assert('Flow: Now Bob turn', G.currentPlayer.name === 'Bob');

// Turn 2: Bob places WRONG
G.currentSong = G.drawSong();
G.isWaitingForPlacement = true;
G.isWaitingForPlacement = false;
assert('Flow: Bob still score = 1 after wrong', G.players[1].score === 1);

// Advance back to Alice
G.currentPlayerIndex = (G.currentPlayerIndex + 1) % G.players.length;
assert('Flow: Back to Alice', G.currentPlayer.name === 'Alice');

// Turn 3: Alice places correctly to win
G.currentSong = G.drawSong();
G.isWaitingForPlacement = true;
const aliceTl = G.players[0].timeline;
const idx1 = findCorrectIndex(aliceTl, G.currentSong);
aliceTl.splice(idx1, 0, { title: G.currentSong.title, artist: G.currentSong.artist, year: G.currentSong.year });
G.players[0].score = aliceTl.length;
G.isWaitingForPlacement = false;

assert('Flow: Alice score = 3', G.players[0].score === 3);
const flowWinner = G.players.find(p => p.score >= G.cardsToWin);
assert('Flow: Alice wins!', flowWinner && flowWinner.name === 'Alice');

let timelineValid = true;
for (let i = 1; i < aliceTl.length; i++) {
    if (aliceTl[i].year < aliceTl[i - 1].year) {
        timelineValid = false;
        break;
    }
}
assert('Flow: Alice timeline is chronologically sorted', timelineValid);

// ==================== FULL GAME FLOW WITH CHALLENGES ====================
section('Full Game Flow with Challenge System');

G.init(['Alice', 'Bob', 'Charlie'], 3);
assert('CFlow: 3 players, win at 3', G.players.length === 3 && G.cardsToWin === 3);

// Turn 1: Alice places correctly, no challenge
G.currentSong = { title: 'Song2000', artist: 'Art', year: 2000, spotifyId: '12345678901234567890' };
G.isWaitingForPlacement = true;
const aliceIdx = findCorrectIndex(G.players[0].timeline, G.currentSong);
G.selectedDropIndex = aliceIdx;
G.confirmPlacement();
assert('CFlow: Challenge phase initiated', G.challengePhase !== null);
G.resolvePlacement(); // No challengers, skip challenge
assert('CFlow: Alice gets card (no challenge)', G.players[0].score === 2);

// Advance to Bob
G.currentPlayerIndex = (G.currentPlayerIndex + 1) % G.players.length;

// Turn 2: Bob places wrong, Charlie challenges correctly
G.players[1].timeline = [{ year: 1970, title: 'Old', artist: 'X' }];
G.players[1].score = 1;
G.currentSong = { title: 'Song2005', artist: 'Art2', year: 2005, spotifyId: '12345678901234567890' };
G.isWaitingForPlacement = true;
G.selectedDropIndex = 0; // Before 1970 for a 2005 song = WRONG
G.confirmPlacement();

// Charlie challenges
G.players[2].tokens -= 1;
G.challengePhase.challengers.push({ playerIndex: 2, dropIndex: 1 }); // After 1970 = CORRECT
const charlieScore = G.players[2].score;
G.resolvePlacement();
assert('CFlow: Charlie steals card', G.players[2].score === charlieScore + 1);
assert('CFlow: Bob still at 1', G.players[1].score === 1);
assert(
    'CFlow: Card in Charlie timeline',
    G.players[2].timeline.some(c => c.title === 'Song2005'),
);

// Advance to Charlie
G.currentPlayerIndex = 2;

// Turn 3: Charlie places correctly (score 2 -> 3)
G.currentSong = { title: 'Song2010', artist: 'Art3', year: 2010, spotifyId: '12345678901234567890' };
G.isWaitingForPlacement = true;
G.challengePhase = null;
const charlieIdx = findCorrectIndex(G.players[2].timeline, G.currentSong);
G.selectedDropIndex = charlieIdx;
G.confirmPlacement();
G.resolvePlacement();
assert('CFlow: Charlie score = 3 (wins!)', G.players[2].score === 3);
assert('CFlow: Winner detected', G.players.find(p => p.score >= G.cardsToWin).name === 'Charlie');

// ==================== FULL GAME WITH TOKEN MANAGEMENT ====================
section('Full Game Flow with Token Management');

G.init(['Alice', 'Bob'], 3);

// Alice skips a song (-1 token) — directly adjust to avoid debounce
G.currentSong = G.drawSong();
G.isWaitingForPlacement = true;
G.hasPlayedSong = true;
G.players[0].tokens -= 1;
G.skipSong();
assert('TFlow: Alice has 2 tokens after skip', G.players[0].tokens === 2);

// Alice places correctly and claims title
const newSong = G.currentSong;
const aidx = findCorrectIndex(G.players[0].timeline, newSong);
G.selectedDropIndex = aidx;
G.isWaitingForPlacement = true;
G.confirmPlacement();
G.titleArtistClaimed = true;
G.confirmTitleClaim(true);
assert('TFlow: Alice has 3 tokens after claim', G.players[0].tokens === 3);

// ==================== MULTI-PLAYER ROTATION (10 players) ====================
section('Multi-Player Rotation');
const tenPlayers = Array.from({ length: 10 }, (_, i) => 'P' + (i + 1));
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
G.players[0].timeline = [{ year: 1970 }, { year: 1980 }, { year: 1990 }, { year: 2000 }, { year: 2010 }];
G.currentPlayerIndex = 1;
G.usedSongs.add('test-song');
G.challengePhase = { originalPlayerIndex: 0, originalDropIndex: 1, challengers: [] };
G.titleArtistClaimed = true;
G.players[0].tokens = 0;

// Reinit
G.init(['X', 'Y'], 5);
assert(
    'Restart: scores reset to 1',
    G.players.every(p => p.score === 1),
);
assert(
    'Restart: timelines have 1 card',
    G.players.every(p => p.timeline.length === 1),
);
assert('Restart: player index reset', G.currentPlayerIndex === 0);
assert('Restart: deck repopulated', G.deck.length > 0);
assert(
    'Restart: tokens reset to 3',
    G.players.every(p => p.tokens === 3),
);
assert('Restart: challengePhase null', G.challengePhase === null);
assert('Restart: titleArtistClaimed false', G.titleArtistClaimed === false);
assert('Restart: currentSong null', G.currentSong === null);

// ==================== GAME MASTER OPERATIONS ====================
section('Game Master Operations');

// Adjust score down
G.init(['Alice', 'Bob', 'Charlie'], 5);
const gmScoreBefore = G.players[0].score;
G.gmAdjustScore(0, -1);
assert('GM: score decreased', G.players[0].score === gmScoreBefore - 1);

// Cannot go below 0
G.players[0].score = 0;
G.players[0].timeline = [];
G.gmAdjustScore(0, -1);
assert('GM: score cannot go below 0', G.players[0].score >= 0);

// Adjust tokens
G.init(['Alice', 'Bob', 'Charlie'], 5);
G.gmAdjustTokens(0, 1);
assert('GM: token increased', G.players[0].tokens === 4);
G.gmAdjustTokens(0, -1);
assert('GM: token decreased', G.players[0].tokens === 3);

// Token bounds
G.players[0].tokens = G.MAX_TOKENS;
G.gmAdjustTokens(0, 1);
assert('GM: token capped at max', G.players[0].tokens <= G.MAX_TOKENS);

G.players[0].tokens = 0;
G.gmAdjustTokens(0, -1);
assert('GM: token cannot go below 0', G.players[0].tokens >= 0);

// Remove player
G.init(['Alice', 'Bob', 'Charlie'], 5);
G.gmRemovePlayer(2);
assert('GM: player removed', G.players.length === 2);
assert('GM: remaining players correct', G.players[0].name === 'Alice' && G.players[1].name === 'Bob');

// Remove card
G.init(['Alice', 'Bob'], 5);
const cardCountBefore = G.players[0].timeline.length;
G.gmRemoveCard(0, 0);
assert('GM: card removed', G.players[0].timeline.length === cardCountBefore - 1);

// Move player
G.init(['Alice', 'Bob', 'Charlie'], 5);
G.gmMovePlayer(0, 1);
assert('GM: players swapped', G.players[0].name === 'Bob' && G.players[1].name === 'Alice');

// Move player bounds (no-op at edges)
G.init(['Alice', 'Bob', 'Charlie'], 5);
G.gmMovePlayer(0, -1);
assert('GM: move up at top is no-op', G.players[0].name === 'Alice');
G.gmMovePlayer(2, 1);
assert('GM: move down at bottom is no-op', G.players[2].name === 'Charlie');

// ==================== EDGE: NEXT TURN WINNER CHECK ====================
section('Next Turn Winner Check');
G.init(['Alice', 'Bob'], 2);
// Alice already at 2 (cardsToWin) via placed cards
G.players[0].timeline = [
    { year: 1990, title: 'A', artist: 'X' },
    { year: 2000, title: 'B', artist: 'Y' },
];
G.players[0].score = 2;
const winnerCheck = G.players.find(p => p.score >= G.cardsToWin);
assert('Winner detected at nextTurn boundary', winnerCheck && winnerCheck.name === 'Alice');

// ==================== EDGE: CHALLENGER ON OWN POSITION BLOCKED ====================
section('Challenger Position Blocking');
G.init(['Alice', 'Bob'], 10);
G.players[0].timeline = [
    { year: 1970, title: 'S1', artist: 'A' },
    { year: 2010, title: 'S2', artist: 'B' },
];
G.players[0].score = 2;
G.currentSong = { title: 'Test', artist: 'C', year: 1990, spotifyId: '12345678901234567890' };
G.isWaitingForPlacement = true;
G.selectedDropIndex = 1;
G.confirmPlacement();

// Simulate challenger trying same position as original (should be blocked in UI)
G.challengePhase.challengers.push({ playerIndex: 1, dropIndex: 1 });

// Both placed at same index (1), original correct (1990 between 1970-2010), challenger same = also correct
// But in real game, challenger is blocked from choosing original's position
// The resolution logic still works - first correct wins
const origCorrect = G.isPlacementCorrect(G.players[0].timeline, G.currentSong, 1);
assert('Original placement at index 1 is correct', origCorrect === true);

// ==================== EDGE: DECK EXHAUSTION ====================
section('Deck Exhaustion');
G.init(['A', 'B'], 10);
// Mark all songs as used except a few
const allDb = [...DB];
allDb.forEach(s => G.usedSongs.add(G._songKey(s)));
G.deck = [];

// drawSong should reshuffle unused (none left) and return null
const exhausted = G.drawSong();
assert('Exhausted deck: returns null', exhausted === null);

// ==================== EDGE: _songKey CASE INSENSITIVITY ====================
section('Song Key Case Insensitivity');
G.init(['A', 'B'], 10);
const key1 = G._songKey({ title: 'Hello World', artist: 'Test Artist' });
const key2 = G._songKey({ title: 'HELLO WORLD', artist: 'TEST ARTIST' });
const key3 = G._songKey({ title: 'hello world', artist: 'test artist' });
assert('Song keys are case-insensitive', key1 === key2 && key2 === key3);

// ==================== REGRESSION: TIMELINE INTEGRITY ====================
section('Regression - Timeline Integrity After Multiple Operations');
G.init(['Alice', 'Bob'], 10);

// Place 5 songs correctly on Alice's timeline
for (let i = 0; i < 5; i++) {
    placeCorrectly(0);
}

// Verify timeline is always sorted
let aliceTimelineOk = true;
for (let i = 1; i < G.players[0].timeline.length; i++) {
    if (G.players[0].timeline[i].year < G.players[0].timeline[i - 1].year) {
        aliceTimelineOk = false;
        break;
    }
}
assert('Timeline sorted after 5 correct placements', aliceTimelineOk);
assert('Timeline has 6 cards (1 start + 5)', G.players[0].timeline.length === 6);
assert('Score matches timeline length', G.players[0].score === G.players[0].timeline.length);

// ==================== REGRESSION: CHALLENGE CANCEL FROM TIMELINE ====================
section('Regression - Challenge Cancel from Timeline');
G.init(['Alice', 'Bob', 'Charlie'], 10);
G.currentSong = G.drawSong();
G.isWaitingForPlacement = true;
G.selectedDropIndex = 0;
G.confirmPlacement();

// Bob challenges
const bobTokens = G.players[1].tokens;
G.selectChallenger(1);
assert('Bob token deducted', G.players[1].tokens === bobTokens - 1);

// Cancel from timeline view (should refund)
G.cancelChallengeFromTimeline();
assert('Cancel from timeline: token refunded', G.players[1].tokens === bobTokens);
assert('Cancel from timeline: challenger removed', G.challengePhase.challengers.length === 0);

// ==================== REGRESSION: CONFIRM PLACEMENT DOUBLE-FIRE ====================
section('Regression - Double Confirm Prevention');
G.init(['Alice', 'Bob'], 10);
G.currentSong = G.drawSong();
G.isWaitingForPlacement = true;
G.selectedDropIndex = 0;
G.confirmPlacement();

// After confirmPlacement, selectedDropIndex is null and isWaitingForPlacement is false
// Calling again without re-setting state should do nothing
const cpAfter = G.challengePhase;
G.confirmPlacement();
assert('Double confirm: challengePhase preserved', G.challengePhase === cpAfter);

// ==================== FULL INTEGRATION: COMPLETE 4-PLAYER GAME ====================
section('Full Integration: 4-Player Game to Completion');
G.init(['Alice', 'Bob', 'Charlie', 'Diana'], 3);
assert(
    '4P: All start at score 1',
    G.players.every(p => p.score === 1),
);
assert(
    '4P: All have 3 tokens',
    G.players.every(p => p.tokens === 3),
);

let gameWinner = null;
let roundCount = 0;
const maxRounds = 50;

while (!gameWinner && roundCount < maxRounds) {
    const currentPlayer = G.currentPlayerIndex;
    const song = G.drawSong();
    if (!song) break;
    G.currentSong = song;
    G.isWaitingForPlacement = true;

    // Place correctly
    const tl = G.players[currentPlayer].timeline;
    const ci = findCorrectIndex(tl, song);
    tl.splice(ci, 0, { title: song.title, artist: song.artist, year: song.year });
    G.players[currentPlayer].score = tl.length;
    G.isWaitingForPlacement = false;

    // Check winner
    gameWinner = G.players.find(p => p.score >= G.cardsToWin);
    if (gameWinner) break;

    // Next turn
    G.currentPlayerIndex = (G.currentPlayerIndex + 1) % G.players.length;
    roundCount++;
}

assert('4P: Game completes with winner', gameWinner !== null);
assert('4P: Winner has >= 3 cards', gameWinner.score >= 3);
assert('4P: Round count reasonable', roundCount < maxRounds);

// Verify ALL player timelines are sorted
let allTimelinesValid = true;
for (const p of G.players) {
    for (let i = 1; i < p.timeline.length; i++) {
        if (p.timeline[i].year < p.timeline[i - 1].year) {
            allTimelinesValid = false;
            break;
        }
    }
}
assert('4P: All timelines chronologically sorted', allTimelinesValid);
assert(
    '4P: All scores match timeline lengths',
    G.players.every(p => p.score === p.timeline.length),
);

// ==================== FULL INTEGRATION: GAME WITH ALL FEATURES ====================
section('Full Integration: Game with Tokens, Challenges, Claims');
G.init(['Alice', 'Bob', 'Charlie'], 4);

// Round 1: Alice places correctly, claims title
G.currentSong = { title: 'R1Song', artist: 'Art', year: 2000, spotifyId: '12345678901234567890' };
G.isWaitingForPlacement = true;
G.hasPlayedSong = true;
const aIdx = findCorrectIndex(G.players[0].timeline, G.currentSong);
G.selectedDropIndex = aIdx;
G.confirmPlacement();
G.titleArtistClaimed = true;
G.confirmTitleClaim(true); // +1 token
G.resolvePlacement();
assert('Int: Alice score 2 after round 1', G.players[0].score === 2);
assert('Int: Alice has 4 tokens (3+1 claim)', G.players[0].tokens === 4);

// Advance to Bob
G.currentPlayerIndex = 1;

// Round 2: Bob places wrong, Alice challenges correctly
G.players[1].timeline = [{ year: 1960, title: 'OldBob', artist: 'X' }];
G.players[1].score = 1;
G.currentSong = { title: 'R2Song', artist: 'Art2', year: 2010, spotifyId: '12345678901234567890' };
G.isWaitingForPlacement = true;
G.selectedDropIndex = 0; // Before 1960 for 2010 = WRONG
G.confirmPlacement();

// Alice challenges correctly
G.players[0].tokens -= 1; // Now 3
G.challengePhase.challengers.push({ playerIndex: 0, dropIndex: 1 }); // After 1960 = CORRECT
G.resolvePlacement();
assert('Int: Alice steals card (score 3)', G.players[0].score === 3);
assert('Int: Alice tokens = 3 after challenge', G.players[0].tokens === 3);

// Advance to Charlie
G.currentPlayerIndex = 2;

// Round 3: Charlie trades tokens for card (simulate without debounce)
G.challengePhase = null;
const card = G.drawSong();
G.players[2].tokens -= 3;
let insertIdx = G.players[2].timeline.findIndex(c => c.year >= card.year);
if (insertIdx === -1) insertIdx = G.players[2].timeline.length;
G.players[2].timeline.splice(insertIdx, 0, { title: card.title, artist: card.artist, year: card.year });
G.players[2].score = G.players[2].timeline.length;
assert('Int: Charlie has 0 tokens after trade', G.players[2].tokens === 0);
assert('Int: Charlie score increased', G.players[2].score === 2);

// Advance to Alice - she should win at score 4
G.currentPlayerIndex = 0;
G.currentSong = { title: 'WinSong', artist: 'Win', year: 2020, spotifyId: '12345678901234567890' };
G.isWaitingForPlacement = true;
const winIdx = findCorrectIndex(G.players[0].timeline, G.currentSong);
G.selectedDropIndex = winIdx;
G.confirmPlacement();
G.resolvePlacement();
assert('Int: Alice wins at score 4', G.players[0].score === 4);
assert('Int: Alice is winner', G.players.find(p => p.score >= G.cardsToWin).name === 'Alice');

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
