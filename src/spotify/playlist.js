// Spotify playlist loading
// Strategy: Fast path (Web API with anon token) → Fallback (embed scraping)

import { fetchViaCorsProxy } from './cors-proxy.js';

export function extractPlaylistId(input) {
    if (!input) return null;
    const urlMatch = input.match(/(?:spotify\.com\/playlist\/|spotify:playlist:)([a-zA-Z0-9]+)/);
    if (urlMatch) return urlMatch[1];
    if (/^[a-zA-Z0-9]{15,25}$/.test(input.trim())) return input.trim();
    return null;
}

export async function fetchViaWebAPI(playlistId, token, signal) {
    if (!token) throw new Error('No token');

    const songs = [];
    let playlistName = 'Spilleliste';

    // Fetch playlist name
    try {
        const nameResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}?fields=name`, {
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
    let apiUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=items(track(id,name,artists(name),album(release_date))),next,total`;
    let pages = 0;
    const MAX_PAGES = 10;

    while (apiUrl && pages < MAX_PAGES) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        pages++;

        const response = await fetch(apiUrl, {
            headers: { Authorization: `Bearer ${token}` },
            signal,
        });

        if (response.status === 429 || response.status === 401 || response.status === 403) {
            throw new Error(`API ${response.status}`);
        }
        if (!response.ok) {
            throw new Error(`Fant ikke spillelisten (${response.status}).`);
        }

        const data = await response.json();

        for (const item of data.items || []) {
            const track = item?.track;
            if (!track || !track.id) continue;

            const releaseDate = track.album?.release_date || '';
            const year = parseInt(releaseDate.substring(0, 4));
            if (!year || isNaN(year)) continue;

            songs.push({
                title: track.name,
                artist: track.artists.map(a => a.name).join(' & '),
                year: year,
                spotifyId: track.id,
            });
        }

        apiUrl = data.next;
    }

    return { songs, name: playlistName };
}

async function fetchTrackReleaseDate(track, signal) {
    const embedUrl = `https://open.spotify.com/embed/track/${track.spotifyId}`;
    const html = await fetchViaCorsProxy(embedUrl, signal, 8000);

    const dateMatch = html.match(/"releaseDate":\{"isoString":"([^"]+)"\}/);
    if (!dateMatch) return null;

    const year = new Date(dateMatch[1]).getFullYear();
    if (!year || isNaN(year)) return null;

    return {
        title: track.title,
        artist: track.artist,
        year: year,
        spotifyId: track.spotifyId,
    };
}

export async function fetchViaEmbedScraping(playlistId, signal, onProgress) {
    const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
    const html = await fetchViaCorsProxy(embedUrl, signal);

    const match = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) throw new Error('Kunne ikke lese spillelistedata fra Spotify.');

    let nextData;
    try {
        nextData = JSON.parse(match[1]);
    } catch (e) {
        throw new Error('Kunne ikke tolke data fra Spotify.');
    }

    const entity = nextData?.props?.pageProps?.state?.data?.entity;

    if (!entity?.trackList || entity.trackList.length === 0) {
        throw new Error('Spillelisten er tom eller utilgjengelig.');
    }

    const trackList = entity.trackList
        .map(t => {
            const idMatch = t.uri?.match(/spotify:track:([a-zA-Z0-9]+)/);
            return { title: t.title, artist: t.subtitle, spotifyId: idMatch?.[1] };
        })
        .filter(t => t.spotifyId && t.title && /^[a-zA-Z0-9]{10,30}$/.test(t.spotifyId));

    const playlistName = entity.name || entity.title;

    // Fetch release dates from individual track embed pages
    const MAX_TRACKS = 200;
    const tracksToFetch = trackList.slice(0, MAX_TRACKS);
    if (trackList.length > MAX_TRACKS) {
        console.warn(`Playlist has ${trackList.length} tracks, limiting to ${MAX_TRACKS}`);
    }

    const BATCH_SIZE = 5;
    const BATCH_DELAY = 300;
    const songs = [];
    let completed = 0;
    const failed = [];

    for (let i = 0; i < tracksToFetch.length; i += BATCH_SIZE) {
        if (signal.aborted) return { songs, name: playlistName };

        const batch = tracksToFetch.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(batch.map(track => fetchTrackReleaseDate(track, signal)));

        for (let j = 0; j < results.length; j++) {
            completed++;
            if (results[j].status === 'fulfilled' && results[j].value) {
                songs.push(results[j].value);
            } else {
                failed.push(batch[j]);
            }
        }

        if (onProgress) onProgress(completed, tracksToFetch.length);

        if (i + BATCH_SIZE < tracksToFetch.length && !signal.aborted) {
            await new Promise(r => setTimeout(r, BATCH_DELAY));
        }
    }

    // Retry failed tracks once
    if (failed.length > 0 && failed.length <= 30 && !signal.aborted) {
        await new Promise(r => setTimeout(r, 1000));
        for (let i = 0; i < failed.length; i += BATCH_SIZE) {
            if (signal.aborted) break;
            const batch = failed.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(batch.map(track => fetchTrackReleaseDate(track, signal)));
            for (const r of results) {
                if (r.status === 'fulfilled' && r.value) songs.push(r.value);
            }
            if (i + BATCH_SIZE < failed.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }
    }

    return { songs, name: playlistName };
}
