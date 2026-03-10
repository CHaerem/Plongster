// Game phase state machine
// Defines explicit phases and valid transitions to prevent invalid states

export const Phase = Object.freeze({
    IDLE: 'IDLE',
    PASS_PHONE: 'PASS_PHONE',
    LISTENING: 'LISTENING',
    PLACING: 'PLACING',
    PLACEMENT_CONFIRM: 'PLACEMENT_CONFIRM',
    PRE_REVEAL: 'PRE_REVEAL',
    CHALLENGER_PASS: 'CHALLENGER_PASS',
    CHALLENGER_PLACING: 'CHALLENGER_PLACING',
    CHALLENGER_CONFIRM: 'CHALLENGER_CONFIRM',
    REVEAL: 'REVEAL',
    TITLE_CLAIM: 'TITLE_CLAIM',
    GAME_OVER: 'GAME_OVER',
});

// Valid transitions: from → [allowed destinations]
const TRANSITIONS = {
    [Phase.IDLE]: [Phase.PASS_PHONE, Phase.GAME_OVER],
    [Phase.PASS_PHONE]: [Phase.LISTENING],
    [Phase.LISTENING]: [Phase.PLACING],
    [Phase.PLACING]: [Phase.PLACEMENT_CONFIRM, Phase.PLACING],
    [Phase.PLACEMENT_CONFIRM]: [Phase.PLACING, Phase.PRE_REVEAL],
    [Phase.PRE_REVEAL]: [
        Phase.REVEAL,
        Phase.CHALLENGER_PASS,
        Phase.PRE_REVEAL, // after challenger places, returns to pre-reveal
    ],
    [Phase.CHALLENGER_PASS]: [Phase.CHALLENGER_PLACING, Phase.PRE_REVEAL],
    [Phase.CHALLENGER_PLACING]: [Phase.CHALLENGER_CONFIRM, Phase.CHALLENGER_PLACING, Phase.PRE_REVEAL],
    [Phase.CHALLENGER_CONFIRM]: [Phase.PRE_REVEAL, Phase.CHALLENGER_PLACING],
    [Phase.REVEAL]: [Phase.TITLE_CLAIM, Phase.PASS_PHONE, Phase.GAME_OVER],
    [Phase.TITLE_CLAIM]: [Phase.PASS_PHONE, Phase.GAME_OVER],
    [Phase.GAME_OVER]: [Phase.IDLE],
};

/**
 * Check if a transition is valid.
 * Returns true if allowed, false if not.
 */
export function isValidTransition(from, to) {
    const allowed = TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
}

/**
 * Attempt a phase transition, logging a warning if invalid.
 * Always returns the new phase (to allow recovery from unexpected states).
 */
export function transition(from, to) {
    if (!isValidTransition(from, to)) {
        console.warn(`Invalid phase transition: ${from} → ${to}`);
    }
    return to;
}
