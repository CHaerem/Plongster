# Plongster

> **[Spill Plongster](https://chaerem.github.io/Plongster/)**

En nettbasert musikkquiz — lytt til sanger og plasser dem i riktig kronologisk rekkefølge på tidslinjen din. Førstemann til målet vinner!

## Hvordan spille

1. **Legg til spillere** (2-10 stk) og trykk Start
2. **Send telefonen** til spilleren som har tur
3. **Lytt til sangen** — trykk play og hør
4. **Plasser sangen** i tidslinjen der du tror den hører hjemme kronologisk
5. **Se om du hadde rett!** Riktig plassering = kortet blir i tidslinjen din
6. **Utfordre** — andre spillere kan utfordre plasseringen din (koster 1 token)
7. **Send videre** til neste spiller

Første spiller som samler nok kort vinner!

## Funksjoner

- **Spotify-integrasjon** — Sanger spilles direkte via Spotify Embed API
- **1200+ sanger** — Fra 1960-tallet til i dag, fordelt over 7 tiår
- **Sjangerfiltrer** — Filtrer på pop, rock, hiphop, elektronisk, norsk
- **Egne spillelister** — Last inn hvilken som helst Spotify-spilleliste
- **Token-system** — Bruk tokens til å utfordre, hoppe over sanger, eller hevde kunnskap
- **Spillkontroll-panel** — Juster score, tokens og spillerrekkefølge underveis
- **Mobilvennlig** — Touch-optimisert design for å sende telefonen rundt
- **Auto-lagring** — Refresh siden uten å miste fremgangen
- **PWA** — Installerbar webapp med offline-støtte
- **Haptic feedback** — Vibrasjon ved riktig/feil plassering (mobil)

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
- Service Worker for offline-caching (PWA)
- CSS med mørkt tema og animasjoner

## Filstruktur

```
├── index.html       # Hovedside med alle skjermer
├── main.js          # Inngangspunkt, setter opp App og Game
├── songs-data.js    # Sangdatabase (1200+ sanger)
├── style.css        # Styling og animasjoner
├── sw.js            # Service Worker for offline-caching
├── manifest.json    # PWA-manifest
├── test.js          # Node.js testsuite
├── tests.html       # Nettleserbasert testsuite
├── src/             # Kildekode (ES-moduler)
├── icons/           # PWA-ikoner (192px, 512px)
└── tools/
    ├── generate-songs.js   # Generer sangdata fra Spotify-spillelister
    └── update-library.sh   # Vedlikeholdsskript
```

## Testing

```bash
# Kjør tester i Node.js
node test.js

# Eller åpne tests.html i nettleseren
```

## Legge til sanger

### Fra Spotify-spilleliste

Bruk generatorverktøyet:

```bash
node tools/generate-songs.js <spotify-playlist-url>
```

Eller last inn en spilleliste direkte i appen under oppsett.
