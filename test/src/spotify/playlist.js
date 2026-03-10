// Spotify playlist utilities

export function extractPlaylistId(input) {
    if (!input) return null;
    const urlMatch = input.match(/(?:spotify\.com\/playlist\/|spotify:playlist:)([a-zA-Z0-9]+)/);
    if (urlMatch) return urlMatch[1];
    if (/^[a-zA-Z0-9]{15,25}$/.test(input.trim())) return input.trim();
    return null;
}
