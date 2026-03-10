#!/usr/bin/env node
/**
 * Update song database from configured playlists.
 *
 * Reads playlist definitions from tools/playlists.json and runs
 * generate-songs.js to rebuild the full database.
 *
 * Usage:
 *   node tools/update-songs.js
 *
 * Requires SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in environment
 * or in tools/.env
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PLAYLISTS_PATH = path.join(__dirname, 'playlists.json');
const GENERATE_SCRIPT = path.join(__dirname, 'generate-songs.js');

function main() {
    if (!fs.existsSync(PLAYLISTS_PATH)) {
        console.error('Error: tools/playlists.json not found');
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(PLAYLISTS_PATH, 'utf-8'));
    const playlists = config.playlists;

    if (!playlists || playlists.length === 0) {
        console.error('Error: No playlists configured in tools/playlists.json');
        process.exit(1);
    }

    console.log(`Updating song database from ${playlists.length} playlists\n`);

    // First playlist replaces, rest append
    for (let i = 0; i < playlists.length; i++) {
        const pl = playlists[i];
        const args = [];

        if (i > 0) args.push('--append');
        if (pl.genre) args.push('--genre', pl.genre);
        args.push(pl.id);

        console.log(`[${i + 1}/${playlists.length}] ${pl.name || pl.id} (${pl.genre || 'no genre'})`);

        try {
            execSync(`node "${GENERATE_SCRIPT}" ${args.join(' ')}`, {
                stdio: 'inherit',
                env: process.env,
            });
        } catch (e) {
            console.error(`Failed to process playlist ${pl.id}: ${e.message}`);
            process.exit(1);
        }

        console.log('');
    }

    console.log('Song database update complete!');
}

main();
