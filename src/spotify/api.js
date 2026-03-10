// Authenticated Spotify Web API client
// Used when the user is logged in via OAuth

import { SPOTIFY_CONFIG } from './config.js';
import { getAccessToken } from './oauth.js';

/**
 * Fetch the user's playlists (paginated).
 * Returns { items: [...], total, hasMore }
 */
export async function fetchUserPlaylists(offset = 0, limit = 50, signal) {
    const token = await getAccessToken();
    if (!token) throw new Error('Ikke logget inn');

    const url = `${SPOTIFY_CONFIG.apiBase}/me/playlists?limit=${limit}&offset=${offset}`;
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
    });

    if (!response.ok) throw new Error(`Feil ved henting av spillelister (${response.status})`);

    const data = await response.json();
    return {
        items: data.items.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description || '',
            trackCount: p.tracks?.total || 0,
            imageUrl: p.images?.[0]?.url || null,
            owner: p.owner?.display_name || '',
        })),
        total: data.total,
        hasMore: data.total > offset + limit,
    };
}

/**
 * Fetch all tracks from a playlist using the authenticated token.
 * Returns { songs: [...], name: string }
 */
export async function fetchPlaylistTracks(playlistId, signal, onProgress) {
    const token = await getAccessToken();
    if (!token) throw new Error('Ikke logget inn');

    // Fetch playlist name
    let playlistName = 'Spilleliste';
    try {
        const nameResp = await fetch(`${SPOTIFY_CONFIG.apiBase}/playlists/${playlistId}?fields=name`, {
            headers: { Authorization: `Bearer ${token}` },
            signal,
        });
        if (nameResp.ok) {
            const nameData = await nameResp.json();
            playlistName = nameData.name || playlistName;
        }
    } catch (e) {
        if (e.name === 'AbortError') throw e;
    }

    // Fetch tracks with pagination
    const songs = [];
    let apiUrl = `${SPOTIFY_CONFIG.apiBase}/playlists/${playlistId}/tracks?limit=100&fields=items(track(id,name,artists(name),album(release_date,images))),next,total`;
    let pages = 0;
    const MAX_PAGES = 10;
    let total = 0;

    while (apiUrl && pages < MAX_PAGES) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        pages++;

        const response = await fetch(apiUrl, {
            headers: { Authorization: `Bearer ${token}` },
            signal,
        });

        if (response.status === 401 || response.status === 403) {
            throw new Error(`API ${response.status}`);
        }
        if (!response.ok) {
            throw new Error(`Fant ikke spillelisten (${response.status}).`);
        }

        const data = await response.json();
        if (pages === 1) total = data.total || 0;

        for (const item of data.items || []) {
            const track = item?.track;
            if (!track || !track.id) continue;

            const releaseDate = track.album?.release_date || '';
            const year = parseInt(releaseDate.substring(0, 4));
            if (!year || isNaN(year)) continue;

            songs.push({
                title: track.name,
                artist: track.artists.map(a => a.name).join(' & '),
                year,
                spotifyId: track.id,
                coverUrl: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || null,
            });
        }

        if (onProgress) onProgress(songs.length, total);
        apiUrl = data.next;
    }

    return { songs, name: playlistName };
}
