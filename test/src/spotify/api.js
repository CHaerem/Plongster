// Authenticated Spotify Web API client
// Used when the user is logged in via OAuth

import { SPOTIFY_CONFIG } from './config.js';
import { getAccessToken } from './oauth.js';
import { extractYear, isValidSong } from '../utils.js';

/**
 * Fetch with automatic retry on 429 (Too Many Requests) responses.
 * Uses Retry-After header or exponential backoff.
 */
async function fetchWithRetry(url, options, maxRetries = 3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const response = await fetch(url, options);
        if (response.status !== 429 || attempt === maxRetries) return response;

        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000 * 2 ** attempt;
        await new Promise(resolve => setTimeout(resolve, delay));

        if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    }
}

/**
 * Fetch the user's playlists (paginated).
 * Returns { items: [...], total, hasMore }
 */
export async function fetchUserPlaylists(offset = 0, limit = 50, signal) {
    const token = await getAccessToken();
    if (!token) throw new Error('Ikke logget inn');

    const url = `${SPOTIFY_CONFIG.apiBase}/me/playlists?limit=${limit}&offset=${offset}`;
    const response = await fetchWithRetry(url, {
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
        const nameResp = await fetchWithRetry(`${SPOTIFY_CONFIG.apiBase}/playlists/${playlistId}?fields=name`, {
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
    let apiUrl = `${SPOTIFY_CONFIG.apiBase}/playlists/${playlistId}/tracks?limit=100&fields=items(track(id,name,artists(name),album(release_date,release_date_precision,images))),next,total`;
    let pages = 0;
    const MAX_PAGES = 10;
    let total = 0;

    while (apiUrl && pages < MAX_PAGES) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        pages++;

        const response = await fetchWithRetry(apiUrl, {
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

            const year = extractYear(track.album?.release_date, track.album?.release_date_precision);
            if (!year) continue;

            const song = {
                title: track.name,
                artist: track.artists.map(a => a.name).join(' & '),
                year,
                spotifyId: track.id,
                coverUrl: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || null,
            };
            if (isValidSong(song)) songs.push(song);
        }

        if (onProgress) onProgress(songs.length, total);
        apiUrl = data.next;
    }

    return { songs, name: playlistName };
}
