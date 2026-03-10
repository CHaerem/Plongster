// Shared utility functions

export function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const CURRENT_YEAR = new Date().getFullYear();

export function isValidSong(song) {
    if (!song || typeof song !== 'object') return false;
    if (typeof song.title !== 'string' || song.title.trim().length === 0) return false;
    if (typeof song.artist !== 'string' || song.artist.trim().length === 0) return false;
    if (typeof song.year !== 'number' || !Number.isInteger(song.year)) return false;
    if (song.year < 1900 || song.year > CURRENT_YEAR + 1) return false;
    if (typeof song.spotifyId !== 'string' || !/^[a-zA-Z0-9]{10,30}$/.test(song.spotifyId)) return false;
    return true;
}

export function extractYear(releaseDate, precision) {
    if (!releaseDate) return null;
    // For "day" or "month" precision, parse the full date for an accurate year
    if (precision === 'day' || precision === 'month') {
        const parsed = new Date(releaseDate);
        if (!isNaN(parsed.getTime())) return parsed.getFullYear();
    }
    // Fallback: extract first 4 digits
    const year = parseInt(releaseDate.substring(0, 4));
    if (!year || isNaN(year)) return null;
    if (year < 1900 || year > CURRENT_YEAR + 1) return null;
    return year;
}

export function shuffleArray(arr) {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Create a debounce guard that blocks rapid repeated calls.
 * Returns a function: call it before the action — returns true if blocked.
 */
export function createDebounce(delay = 300) {
    let blocked = false;
    return () => {
        if (blocked) return true;
        blocked = true;
        setTimeout(() => {
            blocked = false;
        }, delay);
        return false;
    };
}
