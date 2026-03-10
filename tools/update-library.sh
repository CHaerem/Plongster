#!/bin/bash
# =============================================================================
# Plongster Song Library Updater
#
# Regenerates songs.js from curated Spotify playlists.
# No API keys needed — uses Spotify embed pages.
#
# Usage:
#   ./tools/update-library.sh           # Full regeneration
#   ./tools/update-library.sh --dry-run # Preview without writing
#
# Run periodically to keep the library fresh with current hits.
# =============================================================================

set -e
cd "$(dirname "$0")/.."

EXTRA_FLAGS="$@"
TOOL="node tools/generate-songs.js"

echo "╔══════════════════════════════════════════════╗"
echo "║      🎵 Plongster Library Updater              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "This will generate a fresh songs.js from curated Spotify playlists."
echo "No Spotify Developer account needed."
echo ""

# --- Pop (decade playlists — iconic hits across all decades) ---
echo "━━━ POP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
$TOOL --genre pop \
    37i9dQZF1DXaKIA8E7WcJj \
    37i9dQZF1DWTJ7xPn4vNaz \
    37i9dQZF1DX4UtSsGT1Sbe \
    37i9dQZF1DXbTxeAdrVG2l \
    37i9dQZF1DX4o1oenSJRJd \
    37i9dQZF1DX5Ejj0EkURtP \
    37i9dQZF1DXbYM3nMM0oPk \
    $EXTRA_FLAGS

# --- Rock ---
echo ""
echo "━━━ ROCK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
$TOOL --append --genre rock \
    37i9dQZF1DWXRqgorJj26U \
    37i9dQZF1DXdOEFt9ZX0dh \
    $EXTRA_FLAGS

# --- Hip-Hop ---
echo ""
echo "━━━ HIPHOP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
$TOOL --append --genre hiphop \
    37i9dQZF1DX186v583rmzp \
    37i9dQZF1DWY4xHQp97fN6 \
    $EXTRA_FLAGS

# --- Electronic / Dance ---
echo ""
echo "━━━ ELECTRONIC ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
$TOOL --append --genre electronic \
    37i9dQZF1DX8a1tdzq5tbM \
    37i9dQZF1DX0BcQWzuB7ZO \
    $EXTRA_FLAGS

# --- Norsk ---
echo ""
echo "━━━ NORSK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
$TOOL --append --genre norsk \
    37i9dQZF1DWUJF24WXSSyO \
    5KsHCxFXRTc5HXCfvbdEfe \
    $EXTRA_FLAGS

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║      ✅ Library update complete!              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "Remember to:"
echo "  1. Bump cache version in index.html"
echo "  2. Review the changes: git diff songs.js"
echo "  3. Commit: git add songs.js && git commit -m 'Update song library'"
