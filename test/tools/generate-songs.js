#!/usr/bin/env node
/**
 * Hitster Song Generator
 *
 * Generates songs-data.js from one or more Spotify playlists.
 * Uses Spotify Web API (client credentials) — requires API credentials.
 *
 * Usage:
 *   node tools/generate-songs.js <playlist_url_or_id> [more_playlists...]
 *
 * Examples:
 *   node tools/generate-songs.js https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
 *   node tools/generate-songs.js 37i9dQZF1DXcBWIGoYBM5M 37i9dQZF1DX0XUsuxWHRQd
 *   node tools/generate-songs.js --append --genre rock https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
 *   node tools/generate-songs.js --validate
 *
 * Options:
 *   --append          Add songs to existing songs-data.js instead of replacing
 *   --genre <tag>     Tag all songs with this genre
 *   --json            Output as songs.json (for runtime loading)
 *   --dry-run         Show songs without writing files
 *   --validate        Check existing songs for stale/unavailable tracks
 *
 * Setup:
 *   cp tools/.env.example tools/.env
 *   # Edit tools/.env with your Spotify client ID and secret
 *   # Get credentials at https://developer.spotify.com/dashboard
 */

const fs = require('fs');
const path = require('path');

const SONGS_JS_PATH = path.join(__dirname, '..', 'songs-data.js');
const SONGS_JSON_PATH = path.join(__dirname, '..', 'songs.json');
const ENV_PATH = path.join(__dirname, '.env');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ─── Environment ───

function loadEnv() {
    if (!fs.existsSync(ENV_PATH)) return {};
    const env = {};
    fs.readFileSync(ENV_PATH, 'utf-8')
        .split('\n')
        .forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const [key, ...rest] = trimmed.split('=');
            env[key.trim()] = rest.join('=').trim();
        });
    return env;
}

// ─── Spotify Web API (Client Credentials) ───

async function getClientCredentialsToken(clientId, clientSecret) {
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
        body: 'grant_type=client_credentials',
    });
    if (!response.ok) {
        throw new Error(`Token request failed: ${response.status} ${await response.text()}`);
    }
    const data = await response.json();
    return data.access_token;
}

async function fetchPlaylistViaAPI(playlistId, token) {
    const fields = 'name,tracks(total)';
    const url = `https://api.spotify.com/v1/playlists/${playlistId}?fields=${fields}`;
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        throw new Error(`API playlist fetch failed: ${response.status}`);
    }
    return response.json();
}

async function fetchPlaylistTracksViaAPI(playlistId, token) {
    const fields = 'items(track(id,name,artists(name),album(release_date,release_date_precision,images))),next,total';
    let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?fields=${fields}&limit=100`;
    const allItems = [];

    while (url) {
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
            throw new Error(`API tracks fetch failed: ${response.status}`);
        }
        const data = await response.json();
        allItems.push(...data.items);
        url = data.next;

        if (url) {
            process.stdout.write(`\r   Fetching tracks: ${allItems.length}/${data.total || '?'}`);
            await sleep(100);
        }
    }
    process.stdout.write(`\r   Fetched ${allItems.length} tracks                    \n`);
    return allItems;
}

function apiTrackToSong(item, genre) {
    const track = item.track;
    if (!track || !track.id) return null;

    const releaseDate = track.album?.release_date;
    if (!releaseDate) return null;

    let year;
    const precision = track.album?.release_date_precision;
    if (precision === 'day' || precision === 'month') {
        year = new Date(releaseDate).getFullYear();
    } else {
        year = parseInt(releaseDate.substring(0, 4));
    }
    if (!year || isNaN(year) || year < 1900 || year > new Date().getFullYear() + 1) return null;

    const song = {
        title: track.name,
        artist: track.artists.map(a => a.name).join(', '),
        year,
        spotifyId: track.id,
    };

    const coverUrl = track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || null;
    if (coverUrl) song.coverUrl = coverUrl;

    if (genre) song.genre = genre;
    return song;
}

// ─── Validate ───

async function validateExistingSongs(token) {
    const songs = loadExistingSongs();
    if (songs.length === 0) {
        console.log('No existing songs to validate.');
        return;
    }

    console.log(`Validating ${songs.length} songs...\n`);
    const stale = [];
    const BATCH_SIZE = 50;

    for (let i = 0; i < songs.length; i += BATCH_SIZE) {
        const batch = songs.slice(i, i + BATCH_SIZE);
        const ids = batch.map(s => s.spotifyId).join(',');

        const response = await fetch(`https://api.spotify.com/v1/tracks?ids=${ids}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
            const data = await response.json();
            data.tracks.forEach((track, idx) => {
                if (!track) stale.push(batch[idx]);
            });
        }

        const pct = Math.round(((i + batch.length) / songs.length) * 100);
        process.stdout.write(`\r   Checking: ${i + batch.length}/${songs.length} (${pct}%)`);
        await sleep(100);
    }

    process.stdout.write('\n\n');

    if (stale.length === 0) {
        console.log('All songs are valid!');
    } else {
        console.log(`Found ${stale.length} stale/unavailable tracks:`);
        stale.forEach(s => console.log(`  ${s.year} | ${s.title} - ${s.artist} [${s.spotifyId}]`));
    }
}

// ─── Helpers ───

function extractPlaylistId(input) {
    const urlMatch = input.match(/playlist[/:]([a-zA-Z0-9]+)/);
    if (urlMatch) return urlMatch[1];
    if (/^[a-zA-Z0-9]+$/.test(input)) return input;
    throw new Error(`Invalid playlist URL or ID: ${input}`);
}

function deduplicateSongs(songs) {
    const seen = new Set();
    return songs.filter(song => {
        const key = `${song.title.toLowerCase()}-${song.artist.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function groupByDecade(songs) {
    const groups = {};
    songs.forEach(song => {
        const decade = Math.floor(song.year / 10) * 10;
        if (!groups[decade]) groups[decade] = [];
        groups[decade].push(song);
    });
    return groups;
}

function generateSongsJS(songs) {
    const groups = groupByDecade(songs);
    const decades = Object.keys(groups).sort((a, b) => a - b);

    const lines = [];
    lines.push('// Song database with Spotify track IDs');
    lines.push('// Exported as ES module for use by src/songs.js');
    lines.push('// Auto-generated by tools/generate-songs.js');
    lines.push(`// ${songs.length} songs across ${decades.length} decades`);
    lines.push(`// Generated: ${new Date().toISOString().split('T')[0]}`);
    lines.push('export const SONGS_DATA = [');

    for (const decade of decades) {
        const decadeSongs = groups[decade].sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
        lines.push(`    // ${decade}s`);
        for (const song of decadeSongs) {
            const title = song.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const artist = song.artist.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const genrePart = song.genre ? `, genre: "${song.genre}"` : '';
            const coverPart = song.coverUrl ? `, coverUrl: "${song.coverUrl}"` : '';
            lines.push(
                `    { title: "${title}", artist: "${artist}", year: ${song.year}, spotifyId: "${song.spotifyId}"${genrePart}${coverPart} },`,
            );
        }
        lines.push('');
    }

    lines.push('];');
    lines.push('');

    return lines.join('\n');
}

function loadExistingSongs() {
    if (!fs.existsSync(SONGS_JS_PATH)) return [];

    const content = fs.readFileSync(SONGS_JS_PATH, 'utf-8');
    const match = content.match(/(?:export\s+)?(?:let|const)\s+(?:SONGS_DATA|SONGS_DATABASE)\s*=\s*\[([\s\S]*?)\];/);
    if (!match) return [];

    const songs = [];
    const regex =
        /\{\s*title:\s*"([^"]*)",\s*artist:\s*"([^"]*)",\s*year:\s*(\d+),\s*spotifyId:\s*"([^"]*)"(?:,\s*genre:\s*"([^"]*)")?(?:,\s*coverUrl:\s*"([^"]*)")?\s*\}/g;
    let m;
    while ((m = regex.exec(match[1])) !== null) {
        const song = {
            title: m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
            artist: m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
            year: parseInt(m[3]),
            spotifyId: m[4],
        };
        if (m[5]) song.genre = m[5];
        if (m[6]) song.coverUrl = m[6];
        songs.push(song);
    }
    return songs;
}

// ─── Main ───

const VALID_GENRES = [
    'pop',
    'rock',
    'hiphop',
    'electronic',
    'norwegian',
    'soul',
    'country',
    'latin',
    'metal',
    'reggae',
    'jazz',
    'classical',
    'disco',
    'punk',
    'indie',
    'kpop',
    'afrobeats',
];

async function main() {
    const env = loadEnv();
    const clientId = env.SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = env.SPOTIFY_CLIENT_SECRET || process.env.SPOTIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.error('Error: Spotify API credentials required.\n');
        console.error('Setup:');
        console.error('  cp tools/.env.example tools/.env');
        console.error('  # Edit tools/.env with your Spotify client ID and secret');
        console.error('  # Get credentials at https://developer.spotify.com/dashboard');
        process.exit(1);
    }

    const args = process.argv.slice(2);

    // Parse --genre <tag>
    let genre = null;
    const filteredArgs = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--genre' && i + 1 < args.length) {
            genre = args[++i];
            if (!VALID_GENRES.includes(genre)) {
                console.error(`Invalid genre: "${genre}". Valid: ${VALID_GENRES.join(', ')}`);
                process.exit(1);
            }
        } else {
            filteredArgs.push(args[i]);
        }
    }

    const flags = new Set(filteredArgs.filter(a => a.startsWith('--')));
    const inputs = filteredArgs.filter(a => !a.startsWith('--'));

    const appendMode = flags.has('--append');
    const jsonMode = flags.has('--json');
    const dryRun = flags.has('--dry-run');
    const validateMode = flags.has('--validate');

    // Get API token
    let token;
    try {
        token = await getClientCredentialsToken(clientId, clientSecret);
        console.log('Authenticated with Spotify Web API\n');
    } catch (e) {
        console.error(`API authentication failed: ${e.message}`);
        process.exit(1);
    }

    // Handle --validate
    if (validateMode) {
        await validateExistingSongs(token);
        return;
    }

    if (inputs.length === 0) {
        console.log('Usage: node tools/generate-songs.js [options] <playlist_url_or_id> [more...]\n');
        console.log('Options:');
        console.log('  --append          Add songs to existing songs-data.js instead of replacing');
        console.log(`  --genre <tag>     Tag songs with genre (${VALID_GENRES.slice(0, 5).join('/')}/...)`);
        console.log('  --json            Also output songs.json for runtime loading');
        console.log('  --dry-run         Show songs without writing files');
        console.log('  --validate        Check existing songs for stale/unavailable tracks');
        process.exit(1);
    }

    console.log('Hitster Song Generator\n');

    let allSongs = [];

    for (const input of inputs) {
        const playlistId = extractPlaylistId(input);
        console.log(`Fetching playlist: ${playlistId}${genre ? ` [${genre}]` : ''}`);

        const playlist = await fetchPlaylistViaAPI(playlistId, token);
        console.log(`   "${playlist.name}" — ${playlist.tracks.total} tracks`);

        const items = await fetchPlaylistTracksViaAPI(playlistId, token);
        const songs = items.map(item => apiTrackToSong(item, genre)).filter(Boolean);

        console.log(`   ${songs.length} songs with release dates\n`);
        allSongs.push(...songs);

        await sleep(100);
    }

    // Append to existing if requested
    if (appendMode) {
        const existing = loadExistingSongs();
        console.log(`Existing songs: ${existing.length}`);
        allSongs = [...existing, ...allSongs];
    }

    // Deduplicate
    const beforeDedup = allSongs.length;
    allSongs = deduplicateSongs(allSongs);
    if (beforeDedup !== allSongs.length) {
        console.log(`Removed ${beforeDedup - allSongs.length} duplicates`);
    }

    // Sort by year
    allSongs.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));

    // Print summary
    const groups = groupByDecade(allSongs);
    console.log(`\nTotal: ${allSongs.length} songs`);
    Object.keys(groups)
        .sort()
        .forEach(decade => {
            console.log(`   ${decade}s: ${groups[decade].length} songs`);
        });

    // Genre summary
    const genreCounts = {};
    allSongs.forEach(s => {
        const g = s.genre || 'untagged';
        genreCounts[g] = (genreCounts[g] || 0) + 1;
    });
    if (Object.keys(genreCounts).length > 1 || !genreCounts['untagged']) {
        console.log('\nBy genre:');
        Object.entries(genreCounts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([g, count]) => {
                console.log(`   ${g}: ${count} songs`);
            });
    }

    if (dryRun) {
        console.log('\nDry run — no files written');
        allSongs.forEach(s => console.log(`  ${s.year} | ${s.title} - ${s.artist}`));
        return;
    }

    // Write songs-data.js
    const jsContent = generateSongsJS(allSongs);
    fs.writeFileSync(SONGS_JS_PATH, jsContent, 'utf-8');
    console.log(`\nWritten: songs-data.js (${allSongs.length} songs)`);

    // Optionally write songs.json
    if (jsonMode) {
        const jsonContent = JSON.stringify(allSongs, null, 2);
        fs.writeFileSync(SONGS_JSON_PATH, jsonContent, 'utf-8');
        console.log('Written: songs.json');
    }

    console.log('\nDone! Remember to bump CACHE_VERSION in sw.js');
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
