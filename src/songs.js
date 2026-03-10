// Songs store — manages the active song database
// Lazy-loads songs-data.js on first use to avoid blocking initial render

let allSongs = [];
let database = [];
let _loaded = false;

export async function initSongs() {
    if (_loaded) return;
    const { SONGS_DATA } = await import('../songs-data.js');
    allSongs = [...SONGS_DATA];
    database = [...SONGS_DATA];
    _loaded = true;
}

// Synchronous init for test environment where SONGS_DATA is already global
export function initSongsSync(data) {
    allSongs = [...data];
    database = [...data];
    _loaded = true;
}

export function getSongs() {
    return database;
}

export function setSongs(songs) {
    database = songs;
}

export function resetSongs() {
    database = [...allSongs];
}

export function getAllSongs() {
    return allSongs;
}
