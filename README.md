# 🎵 Hitster

> **[Spill Hitster](https://chaerem.github.io/hitster/)**

En nettbasert versjon av musikkquiz-spillet Hitster. Lytt til sanger og plasser dem i riktig kronologisk rekkefølge på tidslinjen din. Førstemann til 10 kort vinner!

## Hvordan spille

1. **Legg til spillere** (2–10 stk) og trykk Start
2. **Send telefonen** til spilleren som har tur
3. **Lytt til sangen** — trykk play og hør
4. **Plasser sangen** i tidslinjen der du tror den hører hjemme kronologisk
5. **Se om du hadde rett!** Riktig plassering = kortet blir i tidslinjen din
6. **Send videre** til neste spiller

Første spiller som samler nok kort vinner! 🏆

## Funksjoner

- 🎧 **Spotify-integrasjon** — Sanger spilles direkte via Spotify Embed API
- 📱 **Mobilvennlig** — Designet for å sende telefonen rundt
- 💾 **Auto-lagring** — Refresh siden uten å miste fremgangen
- 🎶 **130 sanger** — Fra 1950-tallet til 2020-tallet
- 🔒 **Skjult sanginfo** — Tittel og artist vises ikke før du har plassert

## Kjøring

Ingen installasjon kreves — bare en nettleser og internett (for Spotify).

```bash
# Med Python
python3 -m http.server 8080

# Eller åpne index.html direkte i nettleseren
```

Gå til `http://localhost:8080` i nettleseren.

## Teknologi

- Vanilla JavaScript (ingen rammeverk)
- Spotify Embed IFrame API
- localStorage for spilltilstand
- CSS med mørkt tema og animasjoner

## Filstruktur

```
├── index.html   # Hovedside med alle skjermer
├── app.js       # App-kontroller (skjermbytte, oppsett)
├── game.js      # Spillogikk og tilstandshåndtering
├── songs.js     # Sangdatabase (130 sanger)
└── style.css    # Styling og animasjoner
```

## Legge til sanger

Rediger `songs.js` og legg til nye sanger i `SONGS_DATABASE`:

```javascript
{ title: "Sangtittel", artist: "Artist", year: 2024, spotifyId: "SPOTIFY_TRACK_ID" }
```

Spotify Track ID finner du i delingslenken til sangen: `https://open.spotify.com/track/SPOTIFY_TRACK_ID`
