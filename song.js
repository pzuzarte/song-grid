"use strict";
/* A song: its parts (song.sections), each some bars long, with the pattern each grid
   plays in it, or none, and the arrangement (song.order), the parts in the order they
   play, as blocks. A part can be in the arrangement any number of times, or not at all.
   Kept apart from the page so it can be tested. plan() turns a song into what the grids
   follow, as sent through sync.js.

   expand() gives the song as it plays: a copy whose sections are the blocks, in order,
   each a copy of its part with the block's id, and the part's id as part. The functions
   about playing (plan, bounds, sectionAt, totalBars and so on) take either.

   Most grids have 16 numbered patterns, counted here from 0. TD-3 Grid edits one pattern
   at a time, so its part names either "grid", the pattern in its grid, or the id of a
   pattern in its library. null is silence for every grid. */
const Song = (() => {
  const INSTRUMENTS = [
    // melodic: a section's transpose shifts its notes. presets: it can be sent a program
    // change to pick a preset. channel: its MIDI channel, from 0, in an exported MIDI file.
    { name: "S-1 Grid", label: "S-1", url: "https://pzuzarte.github.io/s1-grid/", melodic: true, presets: true, channel: 0 },
    // sounds: a song can keep several of its sounds, not just one.
    { name: "Protein Grid", label: "Protein", url: "https://pzuzarte.github.io/protein-grid/", melodic: true, presets: true, sounds: true, channel: 1 },
    { name: "Bass Station Grid", label: "Bass Station", url: "https://pzuzarte.github.io/bass-station-grid/", melodic: true, presets: true, sounds: true, channel: 2 },
    { name: "MPC Grid", label: "MPC", url: "https://pzuzarte.github.io/mpc-grid/", word: "Sequence", channel: 9 },
    { name: "TD-3 Grid", label: "TD-3", url: "https://pzuzarte.github.io/td3-grid/", library: true, melodic: true, channel: 3 },
  ];
  const BAR = 3840; // Pulses in a bar of 4/4, at 960 to a beat, as the grids count them.
  const GRID = "grid"; // TD-3 Grid's own pattern, rather than one from its library.
  const PATTERNS = 16;
  const BAR_CHOICES = [1, 2, 4, 8, 12, 16, 24, 32, 64];
  const MAX_SECTIONS = 64; // Parts in a song.
  const MAX_BLOCKS = 256; // Blocks in its arrangement.
  const MAX_SOUNDS = 32; // Sounds kept from one grid.
  const COLOURS = 10; // Each part has one of these, so its blocks can be told apart.

  const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  // A grid's pattern, checked, or null for silence.
  function cleanPattern(instrument, value) {
    if (instrument.library) return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : null;
    return Number.isInteger(value) && value >= 0 && value < PATTERNS ? value : null;
  }

  const firstPattern = (instrument) => (instrument.library ? GRID : 0);

  // A grid missing from a saved section is silent in it, so older songs play as they did.
  // A new section starts every grid on its first pattern.
  /* A section can also have its own tempo (bpm, or null for the song's), shift the notes
     of the melodic grids (transpose, in semitones), play a fill pattern in its last bar
     (fills, by grid, left out for none), and pick a preset on the grids that have them as
     it starts (programs, by grid, 0 to 127, left out for none). */
  function section(fields = {}, { fill = true } = {}) {
    const patterns = {};
    const fills = {};
    const programs = {};
    for (const instrument of INSTRUMENTS) {
      const { name } = instrument;
      if (fields.patterns && name in fields.patterns) patterns[name] = cleanPattern(instrument, fields.patterns[name]);
      else patterns[name] = fill ? firstPattern(instrument) : null;
      const fillPattern = fields.fills?.[name];
      if (fillPattern === null || cleanPattern(instrument, fillPattern) !== null) fills[name] = fillPattern === null ? null : cleanPattern(instrument, fillPattern);
      const program = fields.programs?.[name];
      if (instrument.presets && Number.isInteger(program) && program >= 0 && program <= 127) programs[name] = program;
    }
    return {
      id: typeof fields.id === "string" ? fields.id : newId(),
      name: typeof fields.name === "string" ? fields.name.slice(0, 30) : "Section",
      bars: Number.isInteger(fields.bars) && fields.bars >= 1 && fields.bars <= 64 ? fields.bars : 4,
      patterns,
      loop: Boolean(fields.loop), // Repeats each time it's reached, until it's turned off.
      bpm: Number.isFinite(fields.bpm) && fields.bpm >= 20 && fields.bpm <= 300 ? Math.round(fields.bpm * 10) / 10 : null,
      transpose: Number.isInteger(fields.transpose) && fields.transpose >= -12 && fields.transpose <= 12 ? fields.transpose : 0,
      fills,
      programs,
      colour: Number.isInteger(fields.colour) && fields.colour >= 0 && fields.colour < COLOURS ? fields.colour : null,
    };
  }

  // The colour least used by a song's other parts, for a new one.
  function freeColour(sections, except = null) {
    const counts = Array.from({ length: COLOURS }, () => 0);
    for (const item of sections) if (item !== except && item.colour !== null) counts[item.colour] += 1;
    return counts.indexOf(Math.min(...counts));
  }

  // Gives every part without a colour one.
  function colourParts(sections) {
    for (const item of sections) if (item.colour === null) item.colour = freeColour(sections, item);
  }

  const block = (part, id = newId()) => ({ id, part });

  // The arrangement as saved, checked: blocks of parts the song has. A song saved before
  // there was an arrangement plays its parts once each, in order, as it did.
  function cleanOrder(data, sections) {
    if (!Array.isArray(data)) return sections.map((item) => block(item.id));
    const parts = new Set(sections.map((item) => item.id));
    const ids = new Set();
    return data.filter((entry) => entry && parts.has(entry.part)).slice(0, MAX_BLOCKS).map((entry) => {
      const id = typeof entry.id === "string" && !ids.has(entry.id) ? entry.id : newId();
      ids.add(id);
      return block(entry.part, id);
    });
  }

  // The song as it plays: its blocks as sections, in order. See the top of this file.
  function expand(song) {
    if (song.expanded) return song;
    const parts = new Map(song.sections.map((item) => [item.id, item]));
    const sections = (song.order || song.sections.map((item) => block(item.id)))
      .filter((entry) => parts.has(entry.part))
      .map((entry) => ({ ...JSON.parse(JSON.stringify(parts.get(entry.part))), id: entry.id, part: entry.part }));
    return { ...song, sections, order: null, expanded: true };
  }

  const blocks = (song) => expand(song).sections;

  function newSong() {
    const song = {
      name: "",
      bpm: 120,
      loop: false,
      sections: [section({ name: "Intro", bars: 4, colour: 0 }), section({ name: "Main", bars: 8, colour: 1 })],
      order: [],
      assets: {},
    };
    song.order = song.sections.map((item) => block(item.id));
    return song;
  }

  /* A song's assets: for each grid, the patterns and sound collected from it, kept with the
     song. Each pattern has an id, the ref the arrangement uses for it (a pattern number, or
     for TD-3 Grid "grid" or a library id), a label, its length, how many notes it has, and
     the grid's own data for it. sounds are { id, label, data }: the first is the one Load
     sends, its main sound. Most grids keep one, and Protein Grid and Bass Station Grid
     can keep several, each sent with its own button. mainSound() gives the first, or null. */
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
      // Songs saved before there could be several kept one, as sound.
      const ids = new Set();
      const sounds = (Array.isArray(item.sounds) ? item.sounds : [item.sound])
        .filter((entry) => entry && typeof entry.label === "string" && entry.data && typeof entry.data === "object")
        .slice(0, MAX_SOUNDS).map((entry) => {
          let id = typeof entry.id === "string" ? entry.id.slice(0, 80) : `sound:${entry.label}`;
          while (ids.has(id)) id = `${id}+`;
          ids.add(id);
          return { id, label: entry.label.slice(0, 80), data: entry.data };
        });
      assets[name] = { collected: typeof item.collected === "string" ? item.collected : "", patterns, sounds };
    }
    return assets;
  }

  /* Adds patterns and a sound picked from a grid to a song's assets. A pattern already kept
     is replaced, by its id. A pattern from a grid's slot or TD-3 Grid's library comes with
     its ref. One from a library comes without one (null), and goes in the first pattern
     number the arrangement plays that has nothing kept for it, or else the first free one.
     Each pattern number holds one pattern, so a pattern put in one replaces what was there.
     Gives how many patterns were added, and how many didn't fit. */
  function addAssets(song, name, { patterns = [], sound = null, sounds = null } = {}, collected = new Date().toISOString()) {
    const instrument = INSTRUMENTS.find((item) => item.name === name);
    if (!instrument) return { added: 0, full: 0 };
    const kept = song.assets[name] || { collected: "", patterns: [], sounds: [] };
    let added = 0;
    let full = 0;
    for (const entry of patterns) {
      const same = kept.patterns.findIndex((item) => item.id === entry.id);
      let ref = entry.ref ?? (same >= 0 ? kept.patterns[same].ref : null);
      if (same >= 0) kept.patterns.splice(same, 1);
      if (ref === null || ref === undefined) {
        ref = freeSlot(song, name, kept.patterns);
        if (ref === null) {
          full += 1;
          continue;
        }
      }
      if (!instrument.library && !(Number.isInteger(ref) && ref >= 0 && ref < PATTERNS)) continue;
      kept.patterns = kept.patterns.filter((item) => item.ref !== ref);
      kept.patterns.push({ ...entry, ref });
      added += 1;
    }
    kept.sounds = addSounds(instrument, kept.sounds, sounds || (sound ? [sound] : []));
    kept.collected = collected;
    if (!instrument.library) kept.patterns.sort((a, b) => a.ref - b.ref);
    song.assets[name] = cleanAssets({ [name]: kept })[name];
    return { added, full };
  }

  /* Adds sounds to those kept from a grid. One with the same name as one kept replaces it,
     where it was. A grid that keeps one sound keeps the last one added. */
  function addSounds(instrument, kept = [], added = []) {
    const list = instrument.sounds ? [...kept] : [];
    for (const entry of added) {
      if (!entry || typeof entry.label !== "string") continue;
      const same = list.findIndex((item) => item.label === entry.label);
      const sound = { id: entry.id || `sound:${entry.label}`, label: entry.label, data: entry.data };
      if (same >= 0) list[same] = { ...sound, id: list[same].id };
      else if (instrument.sounds) list.push(sound);
      else list.splice(0, list.length, sound);
    }
    return list.slice(0, MAX_SOUNDS);
  }

  const mainSound = (kept) => kept?.sounds?.[0] || null;

  // Makes a kept sound the main one, which Load sends.
  function makeMainSound(song, name, id) {
    const kept = song.assets[name];
    const index = kept?.sounds.findIndex((item) => item.id === id) ?? -1;
    if (index > 0) kept.sounds.unshift(...kept.sounds.splice(index, 1));
  }

  // The pattern number a library pattern goes in, or null if every one holds a pattern.
  function freeSlot(song, name, patterns) {
    const taken = new Set(patterns.map((item) => item.ref));
    const played = song.sections.map((item) => item.patterns[name]).filter((ref) => Number.isInteger(ref));
    const first = played.find((ref) => !taken.has(ref));
    if (first !== undefined) return first;
    for (let ref = 0; ref < PATTERNS; ref += 1) if (!taken.has(ref)) return ref;
    return null;
  }

  // Moves a kept pattern to another pattern number, swapping with the one there if any.
  function moveAsset(song, name, id, ref) {
    const kept = song.assets[name];
    const item = kept?.patterns.find((entry) => entry.id === id);
    if (!item || !Number.isInteger(ref) || ref < 0 || ref >= PATTERNS) return;
    const other = kept.patterns.find((entry) => entry.ref === ref && entry !== item);
    if (other) other.ref = item.ref;
    item.ref = ref;
    kept.patterns.sort((a, b) => a.ref - b.ref);
  }

  // Whether the arrangement plays a pattern, by the ref it knows it by.
  const usesPattern = (song, name, ref) => blocks(song).some((item) => item.patterns[name] === ref);

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
    colourParts(song.sections);
    song.order = cleanOrder(Array.isArray(data.sections) && data.sections.length ? data.order : null, song.sections);
    return song;
  }

  const totalBars = (song) => blocks(song).reduce((sum, item) => sum + item.bars, 0);

  // How long the arrangement takes to play once, in seconds, with each part's tempo.
  const seconds = (song) => blocks(song).reduce((sum, item) => sum + (item.bars * 4 * 60) / (item.bpm ?? song.bpm), 0);

  // Which grids play what, from which bar. Each section starts its patterns from their
  // first step, so every grid lines up at the start of each section.
  // A section with a fill plays it in its last bar, so it needs two bars or more.
  // mutes are the grids muted with Song Grid's mute and solo buttons as it starts.
  function plan(song, { mutes = [] } = {}) {
    const parts = {};
    for (const { name } of INSTRUMENTS) parts[name] = [];
    const played = blocks(song);
    const tempos = played.some((item) => item.bpm !== null);
    let bar = 0;
    for (const item of played) {
      for (const instrument of INSTRUMENTS) {
        const { name } = instrument;
        const cue = { bar, pattern: item.patterns[name] };
        if (tempos) cue.bpm = item.bpm ?? song.bpm;
        if (instrument.melodic && item.transpose) cue.transpose = item.transpose;
        if (name in item.programs) cue.program = item.programs[name];
        parts[name].push(cue);
        if (name in item.fills && item.bars > 1) {
          const fill = { bar: bar + item.bars - 1, pattern: item.fills[name] };
          if (instrument.melodic && item.transpose) fill.transpose = item.transpose;
          parts[name].push(fill);
        }
      }
      bar += item.bars;
    }
    return { bars: bar, loop: song.loop, parts, loops: loops(song), mutes: [...mutes] };
  }

  // The tempo a song starts at.
  const startBpm = (song) => blocks(song)[0]?.bpm ?? song.bpm;

  // A song made from the blocks played, in the order they played, such as from a
  // performance with its jumps and loops: an arrangement with a block for each pass of a
  // looped part, of the parts that played, none of them looping.
  function fromSections(song, indexes, name) {
    const played = blocks(song);
    const picked = indexes.filter((index) => played[index]).slice(0, MAX_BLOCKS).map((index) => played[index]);
    const sections = [];
    for (const item of picked) {
      const part = item.part || item.id;
      if (!sections.some((entry) => entry.id === part)) sections.push({ ...JSON.parse(JSON.stringify(item)), id: part, part: undefined, loop: false });
    }
    const order = picked.map((item) => ({ part: item.part || item.id }));
    return cleanSong({ ...JSON.parse(JSON.stringify({ ...song, expanded: undefined })), name, sections, order, loop: false });
  }

  /* Things in a song that won't play as it looks like they will: a pattern the arrangement
     plays, as a section's pattern or fill, that isn't among the assets kept from its grid,
     when any are kept from it. Each is { section, name, text }. */
  function warnings(song, td3Library = null) {
    const found = [];
    song.sections.forEach((item, index) => {
      for (const instrument of INSTRUMENTS) {
        const { name } = instrument;
        const kept = song.assets[name];
        const check = (ref, what) => {
          if (ref === null || ref === undefined) return;
          if (instrument.library && ref !== GRID && td3Library && !td3Library.some((entry) => entry.id === ref)) {
            found.push({ section: index, name, text: `${instrument.label} ${what} in "${item.name}" isn't in TD-3 Grid's library.` });
          } else if (kept && (kept.patterns.length || kept.sounds.length) && !kept.patterns.some((entry) => entry.ref === ref)) {
            const label = instrument.library ? (ref === GRID ? "the grid pattern" : "a library pattern") : `${(instrument.word || "Pattern").toLowerCase()} ${ref + 1}`;
            found.push({ section: index, name, text: `${instrument.label} plays ${label} ${what === "pattern" ? "" : "as its fill "}in "${item.name}", which isn't kept with the song.`.replace("  ", " ") });
          }
        };
        check(item.patterns[name], "pattern");
        if (item.bars > 1) check(item.fills[name], "fill");
      }
    });
    return found;
  }

  /* ---------- A song as a MIDI file ---------- */

  // A TD-3 Grid pattern's notes: 16ths, or triplets, with ties held and slides overlapping.
  function td3Notes(data) {
    const steps = Array.isArray(data?.steps) ? data.steps : [];
    const length = Number.isInteger(data?.length) ? Math.max(1, Math.min(16, data.length)) : 16;
    const step = data?.triplet ? 320 : 240;
    const notes = [];
    for (let index = 0; index < length; index += 1) {
      const item = steps[index];
      if (!item || item.kind !== "note") continue;
      let span = 1;
      while (index + span < length && steps[index + span]?.kind === "tie") span += 1;
      const height = ((Number.isInteger(item.octave) ? item.octave : 0) + 1) * 12 + (Number.isInteger(item.note) ? item.note : 0);
      notes.push({ note: 24 + height, time: index * step, length: span * step + (item.slide ? step / 4 : 0) - 1, velocity: item.accent ? 1 : 0.6 });
    }
    return { length: length * step, notes };
  }

  // A kept pattern's notes, and how long it is before it repeats, in pulses.
  function patternNotes(instrument, data) {
    if (instrument.library) return td3Notes(data);
    const notes = (Array.isArray(data?.notes) ? data.notes : []).filter((item) => item
      && [item.note, item.time, item.length].every(Number.isFinite) && item.length > 0);
    const length = instrument.word ? data.lengthPulses : data.bars * BAR;
    return { length: Number.isFinite(length) && length > 0 ? length : BAR, notes };
  }

  const vlq = (value) => {
    const bytes = [value & 0x7F];
    for (let rest = value >> 7; rest > 0; rest >>= 7) bytes.unshift((rest & 0x7F) | 0x80);
    return bytes;
  };
  const text = (value) => [...value].map((char) => char.charCodeAt(0)).filter((code) => code >= 32 && code < 127);

  function track(events) {
    events.sort((a, b) => a.time - b.time || a.order - b.order);
    const bytes = [];
    let last = 0;
    for (const { time, data } of events) {
      bytes.push(...vlq(time - last), ...data);
      last = time;
    }
    bytes.push(0x00, 0xFF, 0x2F, 0x00);
    return [0x4D, 0x54, 0x72, 0x6B, (bytes.length >>> 24) & 0xFF, (bytes.length >>> 16) & 0xFF, (bytes.length >>> 8) & 0xFF, bytes.length & 0xFF, ...bytes];
  }

  /* The arrangement as a standard MIDI file, a track for each grid with notes, using the
     patterns kept with the song. Each section plays once, with its fill, transpose, tempo
     and preset. Gives { bytes, missing }, where missing lists what had no kept pattern. */
  function toMidi(song) {
    const PPQ = 960;
    const tempo = (bpm) => {
      const micro = Math.round(60000000 / bpm);
      return [0xFF, 0x51, 0x03, (micro >> 16) & 0xFF, (micro >> 8) & 0xFF, micro & 0xFF];
    };
    const conductor = [
      { time: 0, order: 0, data: [0xFF, 0x03, ...vlq(text(song.name || "Untitled").length), ...text(song.name || "Untitled")] },
      { time: 0, order: 0, data: [0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08] },
    ];
    const tracks = [];
    const missing = new Set();
    let start = 0;
    let bpm = null;
    const played = blocks(song);
    for (const item of played) {
      const itemBpm = item.bpm ?? song.bpm;
      if (itemBpm !== bpm) conductor.push({ time: start, order: 0, data: tempo(itemBpm) });
      bpm = itemBpm;
      const nameBytes = text(item.name);
      conductor.push({ time: start, order: 1, data: [0xFF, 0x06, ...vlq(nameBytes.length), ...nameBytes] });
      start += item.bars * BAR;
    }
    for (const instrument of INSTRUMENTS) {
      const { name, channel } = instrument;
      const events = [];
      const kept = song.assets[name]?.patterns || [];
      let at = 0;
      for (const item of played) {
        const end = at + item.bars * BAR;
        const hasFill = item.bars > 1 && name in item.fills;
        const shift = instrument.melodic ? item.transpose : 0;
        if (name in item.programs) events.push({ time: at, order: 0, data: [0xC0 | channel, item.programs[name]] });
        const place = (ref, from, to) => {
          if (ref === null || ref === undefined) return;
          const entry = kept.find((pattern) => pattern.ref === ref);
          if (!entry) {
            missing.add(`${instrument.label} ${instrument.library ? (ref === GRID ? "grid pattern" : "library pattern") : `${(instrument.word || "pattern").toLowerCase()} ${ref + 1}`}`);
            return;
          }
          const { length, notes } = patternNotes(instrument, entry.data);
          for (let base = from; base < to; base += length) {
            for (const note of notes) {
              const on = Math.round(base + note.time);
              if (on >= to) continue;
              const off = Math.min(to, Math.round(on + note.length));
              const pitch = Math.max(0, Math.min(127, Math.round(note.note) + shift));
              const velocity = Math.max(1, Math.min(127, Math.round((note.velocity ?? 0.8) * 127)));
              events.push({ time: on, order: 2, data: [0x90 | channel, pitch, velocity] });
              events.push({ time: Math.max(on + 1, off), order: 1, data: [0x80 | channel, pitch, 0] });
            }
          }
        };
        place(item.patterns[name], at, hasFill ? end - BAR : end);
        if (hasFill) place(item.fills[name], end - BAR, end);
        at = end;
      }
      if (!events.some((event) => (event.data[0] & 0xF0) === 0x90)) continue;
      const label = text(instrument.label);
      events.push({ time: 0, order: -1, data: [0xFF, 0x03, ...vlq(label.length), ...label] });
      tracks.push(track(events));
    }
    const header = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length + 1, (PPQ >> 8) & 0xFF, PPQ & 0xFF];
    return { bytes: new Uint8Array([...header, ...track(conductor), ...tracks.flat()]), missing: [...missing] };
  }

  // Where each block starts and ends, in bars.
  function bounds(song) {
    let start = 0;
    return blocks(song).map((item) => {
      const range = { start, end: start + item.bars };
      start = range.end;
      return range;
    });
  }

  // The stretches of bars that repeat: the sections with Loop on.
  const loops = (song) => {
    const played = blocks(song);
    return bounds(song).filter((range, index) => played[index].loop);
  };

  // The section playing at a bar counted from 0, and the bar within it.
  function sectionAt(song, bar) {
    let start = 0;
    for (const [index, item] of blocks(song).entries()) {
      if (bar < start + item.bars) return { index, bar: bar - start };
      start += item.bars;
    }
    return null;
  }

  return {
    BAR_CHOICES, COLOURS, GRID, INSTRUMENTS, MAX_BLOCKS, MAX_SECTIONS, MAX_SOUNDS, PATTERNS, addAssets, addSounds, block, bounds, cleanAssets, cleanSong, expand,
    freeColour, fromSections, loops, mainSound, makeMainSound, moveAsset, newSong, plan, seconds, section, sectionAt, startBpm, toMidi, totalBars, usesPattern, warnings,
  };
})();

if (typeof module !== "undefined") module.exports = Song;
