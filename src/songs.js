// Songs store — manages the active song database
// Replaces the mutable global SONGS_DATABASE with getter/setter pattern

import { SONGS_DATA } from '../songs-data.js';

const allSongs = [...SONGS_DATA];
let database = [...SONGS_DATA];

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
