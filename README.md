# Song Grid

**[Open Song Grid](https://pzuzarte.github.io/song-grid/)**

Arranges the patterns you've made in the grid editors into a song, and plays them together
on your instruments. It makes no sound itself: it tells each open grid which pattern to
play, and when.

It works with [S-1 Grid](https://pzuzarte.github.io/s1-grid/),
[Protein Grid](https://pzuzarte.github.io/protein-grid/) and
[Bass Station Grid](https://pzuzarte.github.io/bass-station-grid/), open in other tabs of the
same browser with Sync ticked. Unofficial, and not affiliated with Roland, Waldorf or Novation.

Visits to the page are counted anonymously with
[GoatCounter](https://www.goatcounter.com/help/privacy), which uses no cookies.

**Requires a current version of Google Chrome or Microsoft Edge.**

## What it does

- **Sections:** a song is a row of sections, such as Intro, Verse and Chorus, each some bars
  long. Move, copy and delete them.
- **Patterns:** for each section, choose the pattern each grid plays, 1 to 16, or Off. Every
  grid starts its pattern from the first step at the start of each section, so they stay
  together even when their patterns are different lengths.
- **Play:** starts every linked grid at the song's tempo, highlights the section playing,
  and stops them all at the end, or loops.
- **Saved songs:** kept in the browser by name, with backup and restore to a file.

## How it works

The grids already pass Play, Stop and tempo between each other in the browser (see
`sync.js`, shared by every grid). Just before it starts them, Song Grid sends each grid its
part of the song: which pattern starts at which bar, or silence, and how long the song is.
Each grid then follows that from its own clock. Pressing Play on a grid plays it on its own,
without the song.

## Running it yourself

The page is plain HTML, CSS and JavaScript, with nothing to build. Serve the folder that
holds it and the grids from one local web server, so they share an address:

```bash
python3 -m http.server 8790 --bind 127.0.0.1
```

## Tests

```bash
node --test "test/*.test.js"
```
