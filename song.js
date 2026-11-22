"use strict";
/* A song: sections in order, each some bars long, with the pattern each grid plays in it,
   or none. Kept apart from the page so it can be tested. plan() turns a song into what
   the grids follow, as sent through sync.js.

   Most grids have 16 numbered patterns, counted here from 0. TD-3 Grid edits one pattern
   at a time, so its part names either "grid", the pattern in its grid, or the id of a
   pattern in its library. null is silence for every grid. */
const Song = (() => {
  const INSTRUMENTS = [
    { name: "S-1 Grid", label: "S-1", url: "https://pzuzarte.github.io/s1-grid/" },
    { name: "Protein Grid", label: "Protein", url: "https://pzuzarte.github.io/protein-grid/" },
    { name: "Bass Station Grid", label: "Bass Station", url: "https://pzuzarte.github.io/bass-station-grid/" },
    { name: "MPC Grid", label: "MPC", url: "https://pzuzarte.github.io/mpc-grid/", word: "Sequence" },
    { name: "TD-3 Grid", label: "TD-3", url: "https://pzuzarte.github.io/td3-grid/", library: true },
  ];
  const GRID = "grid"; // TD-3 Grid's own pattern, rather than one from its library.
  const PATTERNS = 16;
  const BAR_CHOICES = [1, 2, 4, 8, 12, 16, 24, 32, 64];
  const MAX_SECTIONS = 64;

  const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  // A grid's pattern, checked, or null for silence.
  function cleanPattern(instrument, value) {
    if (instrument.library) return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : null;
    return Number.isInteger(value) && value >= 0 && value < PATTERNS ? value : null;
  }

  const firstPattern = (instrument) => (instrument.library ? GRID : 0);

  // A grid missing from a saved section is silent in it, so older songs play as they did.
  // A new section starts every grid on its first pattern.
  function section(fields = {}, { fill = true } = {}) {
    const patterns = {};
    for (const instrument of INSTRUMENTS) {
      const { name } = instrument;
      if (fields.patterns && name in fields.patterns) patterns[name] = cleanPattern(instrument, fields.patterns[name]);
      else patterns[name] = fill ? firstPattern(instrument) : null;
    }
    return {
      id: typeof fields.id === "string" ? fields.id : newId(),
      name: typeof fields.name === "string" ? fields.name.slice(0, 30) : "Section",
      bars: Number.isInteger(fields.bars) && fields.bars >= 1 && fields.bars <= 64 ? fields.bars : 4,
      patterns,
      loop: Boolean(fields.loop), // Repeats each time it's reached, until it's turned off.
    };
  }

  function newSong() {
    return {
      name: "",
      bpm: 120,
      loop: false,
      sections: [section({ name: "Intro", bars: 4 }), section({ name: "Main", bars: 8 })],
      assets: {},
    };
  }

  /* A song's assets: for each grid, the patterns and sound collected from it, kept with the
     song. Each pattern has an id, the ref the arrangement uses for it (a pattern number, or
     for TD-3 Grid "grid" or a library id), a label, its length, how many notes it has, and
     the grid's own data for it. The sound is { label, data }, or null. */
  function cleanAssets(data) {
    const assets = {};
    if (!data || typeof data !== "object") return assets;
    for (const { name } of INSTRUMENTS) {
      const item = data[name];
      if (!item || typeof item !== "object" || !Array.isArray(item.patterns)) continue;
      const patterns = item.patterns.filter((entry) => entry && typeof entry.id === "string" && typeof entry.label === "string"
        && (Number.isInteger(entry.ref) || typeof entry.ref === "string") && entry.data && typeof entry.data === "object")
        .map((entry) => ({
          id: entry.id.slice(0, 80), ref: entry.ref, label: entry.label.slice(0, 60),
          length: typeof entry.length === "string" ? entry.length.slice(0, 30) : "",
          notes: Number.isInteger(entry.notes) ? entry.notes : 0, data: entry.data,
        }));
      const sound = item.sound && typeof item.sound.label === "string" && item.sound.data && typeof item.sound.data === "object"
        ? { label: item.sound.label.slice(0, 80), data: item.sound.data } : null;
      assets[name] = { collected: typeof item.collected === "string" ? item.collected : "", patterns, sound };
    }
    return assets;
  }

  // Whether the arrangement plays a pattern, by the ref it knows it by.
  const usesPattern = (song, name, ref) => song.sections.some((item) => item.patterns[name] === ref);

  // A song from saved data, with anything missing or wrong set to a default.
  function cleanSong(data) {
    const song = newSong();
    if (!data || typeof data !== "object") return song;
    if (typeof data.name === "string") song.name = data.name.slice(0, 40);
    if (Number.isFinite(data.bpm) && data.bpm >= 20 && data.bpm <= 300) song.bpm = Math.round(data.bpm * 10) / 10;
    song.loop = Boolean(data.loop);
    song.assets = cleanAssets(data.assets);
    if (Array.isArray(data.sections) && data.sections.length) {
      song.sections = data.sections.slice(0, MAX_SECTIONS).map((item) => section(item, { fill: false }));
      // Each section needs its own id, as copies are moved about separately.
      const ids = new Set();
      for (const item of song.sections) {
        if (ids.has(item.id)) item.id = newId();
        ids.add(item.id);
      }
    }
    return song;
  }

  const totalBars = (song) => song.sections.reduce((sum, item) => sum + item.bars, 0);

  // Which grids play what, from which bar. Each section starts its patterns from their
  // first step, so every grid lines up at the start of each section.
  function plan(song) {
    const parts = {};
    for (const { name } of INSTRUMENTS) parts[name] = [];
    let bar = 0;
    for (const item of song.sections) {
      for (const { name } of INSTRUMENTS) parts[name].push({ bar, pattern: item.patterns[name] });
      bar += item.bars;
    }
    return { bars: bar, loop: song.loop, parts, loops: loops(song) };
  }

  // Where each section starts and ends, in bars.
  function bounds(song) {
    let start = 0;
    return song.sections.map((item) => {
      const range = { start, end: start + item.bars };
      start = range.end;
      return range;
    });
  }

  // The stretches of bars that repeat: the sections with Loop on.
  const loops = (song) => bounds(song).filter((range, index) => song.sections[index].loop);

  // The section playing at a bar counted from 0, and the bar within it.
  function sectionAt(song, bar) {
    let start = 0;
    for (const [index, item] of song.sections.entries()) {
      if (bar < start + item.bars) return { index, bar: bar - start };
      start += item.bars;
    }
    return null;
  }

  return { BAR_CHOICES, GRID, INSTRUMENTS, MAX_SECTIONS, PATTERNS, bounds, cleanAssets, cleanSong, loops, newSong, plan, section, sectionAt, totalBars, usesPattern };
})();

if (typeof module !== "undefined") module.exports = Song;
