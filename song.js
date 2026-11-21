"use strict";
/* A song: sections in order, each some bars long, with the pattern each grid plays in it,
   or none. Kept apart from the page so it can be tested. plan() turns a song into what
   the grids follow, as sent through sync.js. */
const Song = (() => {
  const INSTRUMENTS = [
    { name: "S-1 Grid", label: "S-1", url: "https://pzuzarte.github.io/s1-grid/" },
    { name: "Protein Grid", label: "Protein", url: "https://pzuzarte.github.io/protein-grid/" },
    { name: "Bass Station Grid", label: "Bass Station", url: "https://pzuzarte.github.io/bass-station-grid/" },
  ];
  const PATTERNS = 16;
  const BAR_CHOICES = [1, 2, 4, 8, 12, 16, 24, 32, 64];
  const MAX_SECTIONS = 64;

  const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  // A pattern number counted from 0, or null for silence.
  const cleanPattern = (value) => (Number.isInteger(value) && value >= 0 && value < PATTERNS ? value : null);

  function section(fields = {}) {
    const patterns = {};
    for (const { name } of INSTRUMENTS) {
      patterns[name] = fields.patterns && name in fields.patterns ? cleanPattern(fields.patterns[name]) : 0;
    }
    return {
      id: typeof fields.id === "string" ? fields.id : newId(),
      name: typeof fields.name === "string" ? fields.name.slice(0, 30) : "Section",
      bars: Number.isInteger(fields.bars) && fields.bars >= 1 && fields.bars <= 64 ? fields.bars : 4,
      patterns,
    };
  }

  function newSong() {
    return {
      name: "",
      bpm: 120,
      loop: false,
      sections: [section({ name: "Intro", bars: 4 }), section({ name: "Main", bars: 8 })],
    };
  }

  // A song from saved data, with anything missing or wrong set to a default.
  function cleanSong(data) {
    const song = newSong();
    if (!data || typeof data !== "object") return song;
    if (typeof data.name === "string") song.name = data.name.slice(0, 40);
    if (Number.isFinite(data.bpm) && data.bpm >= 20 && data.bpm <= 300) song.bpm = Math.round(data.bpm * 10) / 10;
    song.loop = Boolean(data.loop);
    if (Array.isArray(data.sections) && data.sections.length) {
      song.sections = data.sections.slice(0, MAX_SECTIONS).map(section);
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
    return { bars: bar, loop: song.loop, parts };
  }

  // The section playing at a bar counted from 0, and the bar within it.
  function sectionAt(song, bar) {
    let start = 0;
    for (const [index, item] of song.sections.entries()) {
      if (bar < start + item.bars) return { index, bar: bar - start };
      start += item.bars;
    }
    return null;
  }

  return { BAR_CHOICES, INSTRUMENTS, MAX_SECTIONS, PATTERNS, cleanSong, newSong, plan, section, sectionAt, totalBars };
})();

if (typeof module !== "undefined") module.exports = Song;
