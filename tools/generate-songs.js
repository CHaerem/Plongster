#!/usr/bin/env node
/**
 * Hitster Song Generator
 *
 * Generates songs.js from one or more Spotify playlists.
 * Uses Spotify embed pages — no API keys or Developer account needed.
 *
 * Usage:
 *   node tools/generate-songs.js <playlist_url_or_id> [more_playlists...]
 *
 * Examples:
 *   node tools/generate-songs.js https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
 *   node tools/generate-songs.js 37i9dQZF1DXcBWIGoYBM5M 37i9dQZF1DX0XUsuxWHRQd
 *   node tools/generate-songs.js --append --genre rock https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
 *
 * Options:
 *   --append          Add songs to existing songs.js instead of replacing
 *   --genre <tag>     Tag all songs with this genre (rock/pop/hiphop/electronic/norsk)
 *   --json            Output as songs.json (for runtime loading)
 *   --dry-run         Show songs without writing files
 */

const fs = require('fs');
const path = require('path');

const SONGS_JS_PATH = path.join(__dirname, '..', 'songs.js');
const SONGS_JSON_PATH = path.join(__dirname, '..', 'songs.json');
const BATCH_SIZE = 10;       // Parallel embed fetches
const BATCH_DELAY_MS = 500;  // Delay between batches

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// --- Spotify Embed Scraping ---

function parseNextData(html) {
    const match = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return null;
    try { return JSON.parse(match[1]); } catch (e) { return null; }
}

async function fetchPlaylistFromEmbed(playlistId) {
    const url = `https://open.spotify.com/embed/playlist/${playlistId}`;
    const response = await fetch(url, { headers: HEADERS });

    if (!response.ok) {
        throw new Error(`Failed to fetch playlist embed: ${response.status}`);
    }

    const html = await response.text();
    const data = parseNextData(html);
    if (!data) throw new Error('Could not parse playlist embed page');

    const entity = data?.props?.pageProps?.state?.data?.entity;
    if (!entity || !entity.trackList) {
        throw new Error('No track data in playlist embed');
    }

    const tracks = entity.trackList.map(t => ({
        spotifyId: t.uri.split(':')[2],
        title: t.title,
        artist: t.subtitle,
    }));

    return { name: entity.name || playlistId, tracks };
}

async function fetchTrackYear(spotifyId, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const url = `https://open.spotify.com/embed/track/${spotifyId}`;
            const response = await fetch(url, { headers: HEADERS });
            if (!response.ok) {
                if (attempt < retries) { await sleep(1000); continue; }
                return 0;
            }

            const html = await response.text();
            const data = parseNextData(html);
            if (!data) return 0;

            const entity = data?.props?.pageProps?.state?.data?.entity;
            if (!entity?.releaseDate?.isoString) return 0;

            return new Date(entity.releaseDate.isoString).getFullYear();
        } catch (e) {
            if (attempt < retries) { await sleep(1000); continue; }
            return 0;
        }
    }
    return 0;
}

async function enrichTracksWithYears(tracks, playlistName) {
    const total = tracks.length;
    let completed = 0;
    let skipped = 0;

    // Process in batches
    for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
        const batch = tracks.slice(i, i + BATCH_SIZE);

        await Promise.all(batch.map(async (track) => {
            track.year = await fetchTrackYear(track.spotifyId);
            completed++;
        }));

        // Progress indicator
        const pct = Math.round((completed / total) * 100);
        process.stdout.write(`\r   📅 Release dates: ${completed}/${total} (${pct}%)`);

        // Delay between batches to be gentle
        if (i + BATCH_SIZE < tracks.length) {
            await sleep(BATCH_DELAY_MS);
        }
    }

    // Filter out tracks without years
    const withYears = tracks.filter(t => {
        if (t.year === 0) {
            skipped++;
            return false;
        }
        return true;
    });

    process.stdout.write('\n');
    if (skipped > 0) {
        console.warn(`   ⚠ Skipped ${skipped} tracks without release year`);
    }

    return withYears;
}

// --- Helpers ---

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

    let lines = [];
    lines.push('// Song database with Spotify track IDs');
    lines.push('// Auto-generated by tools/generate-songs.js');
    lines.push(`// ${songs.length} songs across ${decades.length} decades`);
    lines.push(`// Generated: ${new Date().toISOString().split('T')[0]}`);
    lines.push('// Can be replaced at runtime by loading a custom JSON song list');
    lines.push('let SONGS_DATABASE = [');

    for (const decade of decades) {
        const decadeSongs = groups[decade].sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
        lines.push(`    // ${decade}s`);
        for (const song of decadeSongs) {
            const title = song.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const artist = song.artist.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const genrePart = song.genre ? `, genre: "${song.genre}"` : '';
            lines.push(`    { title: "${title}", artist: "${artist}", year: ${song.year}, spotifyId: "${song.spotifyId}"${genrePart} },`);
        }
        lines.push('');
    }

    lines.push('];');
    lines.push('');
    lines.push('// Fisher-Yates shuffle');
    lines.push('function shuffleArray(arr) {');
    lines.push('    const shuffled = [...arr];');
    lines.push('    for (let i = shuffled.length - 1; i > 0; i--) {');
    lines.push('        const j = Math.floor(Math.random() * (i + 1));');
    lines.push('        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];');
    lines.push('    }');
    lines.push('    return shuffled;');
    lines.push('}');
    lines.push('');

    return lines.join('\n');
}

function loadExistingSongs() {
    if (!fs.existsSync(SONGS_JS_PATH)) return [];

    const content = fs.readFileSync(SONGS_JS_PATH, 'utf-8');
    const match = content.match(/(?:let|const)\s+SONGS_DATABASE\s*=\s*\[([\s\S]*?)\];/);
    if (!match) return [];

    const songs = [];
    const regex = /\{\s*title:\s*"([^"]*)",\s*artist:\s*"([^"]*)",\s*year:\s*(\d+),\s*spotifyId:\s*"([^"]*)"(?:,\s*genre:\s*"([^"]*)")?\s*\}/g;
    let m;
    while ((m = regex.exec(match[1])) !== null) {
        const song = {
            title: m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
            artist: m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
            year: parseInt(m[3]),
            spotifyId: m[4],
        };
        if (m[5]) song.genre = m[5];
        songs.push(song);
    }
    return songs;
}

// --- Main ---

async function main() {
    const args = process.argv.slice(2);

    // Parse --genre <tag>
    let genre = null;
    const filteredArgs = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--genre' && i + 1 < args.length) {
            genre = args[++i];
            const validGenres = ['rock', 'pop', 'hiphop', 'electronic', 'norsk'];
            if (!validGenres.includes(genre)) {
                console.error(`❌ Invalid genre: "${genre}". Valid: ${validGenres.join(', ')}`);
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

    if (inputs.length === 0) {
        console.log('Usage: node tools/generate-songs.js [--append] [--genre <tag>] [--json] [--dry-run] <playlist_url_or_id> [more...]');
        console.log('');
        console.log('Example: node tools/generate-songs.js --genre rock https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
        console.log('');
        console.log('Options:');
        console.log('  --append          Add songs to existing songs.js instead of replacing');
        console.log('  --genre <tag>     Tag songs with genre (rock/pop/hiphop/electronic/norsk)');
        console.log('  --json            Also output songs.json for runtime loading');
        console.log('  --dry-run         Show songs without writing files');
        console.log('');
        console.log('No Spotify Developer account needed.');
        process.exit(1);
    }

    console.log('🎵 Hitster Song Generator\n');
    console.log('No API keys needed — using Spotify embed pages.\n');

    let allSongs = [];

    for (const input of inputs) {
        const playlistId = extractPlaylistId(input);
        console.log(`📋 Fetching playlist: ${playlistId}${genre ? ` [${genre}]` : ''}`);

        // Step 1: Get track list from playlist embed
        const { name, tracks } = await fetchPlaylistFromEmbed(playlistId);
        console.log(`   "${name}" — ${tracks.length} tracks`);

        // Step 2: Enrich with release years from individual track embeds
        const enriched = await enrichTracksWithYears(tracks, name);

        // Add genre tag
        const songs = enriched.map(t => {
            const song = {
                title: t.title,
                artist: t.artist,
                year: t.year,
                spotifyId: t.spotifyId,
            };
            if (genre) song.genre = genre;
            return song;
        });

        console.log(`   ✅ ${songs.length} songs with release dates\n`);
        allSongs.push(...songs);

        // Delay between playlists
        await sleep(1000);
    }

    // Append to existing if requested
    if (appendMode) {
        const existing = loadExistingSongs();
        console.log(`📂 Existing songs: ${existing.length}`);
        allSongs = [...existing, ...allSongs];
    }

    // Deduplicate
    const beforeDedup = allSongs.length;
    allSongs = deduplicateSongs(allSongs);
    if (beforeDedup !== allSongs.length) {
        console.log(`🔄 Removed ${beforeDedup - allSongs.length} duplicates`);
    }

    // Sort by year
    allSongs.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));

    // Print summary
    const groups = groupByDecade(allSongs);
    console.log(`\n📊 Total: ${allSongs.length} songs`);
    Object.keys(groups).sort().forEach(decade => {
        console.log(`   ${decade}s: ${groups[decade].length} songs`);
    });

    // Genre summary
    const genreCounts = {};
    allSongs.forEach(s => {
        const g = s.genre || 'untagged';
        genreCounts[g] = (genreCounts[g] || 0) + 1;
    });
    if (Object.keys(genreCounts).length > 1 || !genreCounts['untagged']) {
        console.log('\n🎸 By genre:');
        Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).forEach(([g, count]) => {
            console.log(`   ${g}: ${count} songs`);
        });
    }

    if (dryRun) {
        console.log('\n🏃 Dry run — no files written');
        allSongs.forEach(s => console.log(`  ${s.year} | ${s.title} — ${s.artist}`));
        return;
    }

    // Write songs.js
    const jsContent = generateSongsJS(allSongs);
    fs.writeFileSync(SONGS_JS_PATH, jsContent, 'utf-8');
    console.log(`\n✅ Written: songs.js (${allSongs.length} songs)`);

    // Optionally write songs.json
    if (jsonMode) {
        const jsonContent = JSON.stringify(allSongs, null, 2);
        fs.writeFileSync(SONGS_JSON_PATH, jsonContent, 'utf-8');
        console.log(`✅ Written: songs.json`);
    }

    console.log('\n🎉 Done! Remember to bump cache version in index.html');
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
