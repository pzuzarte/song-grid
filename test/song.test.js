"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const Song = require("../song.js");
const Sync = require("../sync.js");

const verse = (patterns) => Song.section({ name: "Verse", bars: 8, patterns });

test("a new song has every grid on its first pattern", () => {
  const song = Song.newSong();
  assert.deepEqual(song.sections.map((item) => [item.name, item.bars]), [["Intro", 4], ["Main", 8]]);
  for (const item of song.sections) {
    assert.deepEqual(item.patterns, { "S-1 Grid": 0, "Protein Grid": 0, "Bass Station Grid": 0, "MPC Grid": 0, "TD-3 Grid": "grid" });
  }
  assert.equal(Song.totalBars(song), 12);
});

test("the plan cues each grid at the start of every section", () => {
  const song = Song.cleanSong({
    bpm: 124,
    loop: true,
    sections: [
      { name: "Intro", bars: 4, patterns: { "S-1 Grid": 0, "Protein Grid": null, "Bass Station Grid": null } },
      { name: "Drop", bars: 8, patterns: { "S-1 Grid": 1, "Protein Grid": 2, "Bass Station Grid": 0 } },
      { name: "Outro", bars: 2, patterns: { "S-1 Grid": 0, "Protein Grid": null, "Bass Station Grid": 15 } },
    ],
  });
  const plan = Song.plan(song);
  assert.equal(plan.bars, 14);
  assert.equal(plan.loop, true);
  assert.deepEqual(plan.parts["Protein Grid"], [{ bar: 0, pattern: null }, { bar: 4, pattern: 2 }, { bar: 12, pattern: null }]);
  assert.deepEqual(plan.parts["Bass Station Grid"].map((cue) => cue.pattern), [null, 0, 15]);
  // It reads back through sync.js the way each grid gets it.
  assert.deepEqual(Sync.songPart(plan, "S-1 Grid"), { name: "S-1 Grid", bars: 14, loop: true, cues: [{ bar: 0, pattern: 0 }, { bar: 4, pattern: 1 }, { bar: 12, pattern: 0 }], loops: [], mutes: [] });
});

test("the section and bar playing at any point", () => {
  const song = Song.cleanSong({ sections: [{ name: "A", bars: 4 }, { name: "B", bars: 8 }] });
  assert.deepEqual(Song.sectionAt(song, 0), { index: 0, bar: 0 });
  assert.deepEqual(Song.sectionAt(song, 3), { index: 0, bar: 3 });
  assert.deepEqual(Song.sectionAt(song, 4), { index: 1, bar: 0 });
  assert.deepEqual(Song.sectionAt(song, 11), { index: 1, bar: 7 });
  assert.equal(Song.sectionAt(song, 12), null);
});

test("saved songs are checked, with defaults for anything wrong", () => {
  const song = Song.cleanSong({
    name: "x".repeat(80),
    bpm: 999,
    sections: [{ id: "same", bars: 0, patterns: { "S-1 Grid": 20, "Protein Grid": 3 } }, { id: "same", bars: 16 }],
  });
  assert.equal(song.name.length, 40);
  assert.equal(song.bpm, 120);
  assert.equal(song.sections[0].bars, 4);
  assert.equal(song.sections[0].patterns["S-1 Grid"], null);
  assert.equal(song.sections[0].patterns["Protein Grid"], 3);
  assert.equal(song.sections[0].patterns["Bass Station Grid"], null, "a grid missing from a saved section is silent");
  assert.notEqual(song.sections[0].id, song.sections[1].id);
  assert.deepEqual(Song.cleanSong(null).sections.length, 2);
  assert.deepEqual(Song.cleanSong({ sections: [] }).sections.length, 2);
});

test("copies of one section play the same patterns", () => {
  const song = Song.cleanSong({ sections: [verse({ "S-1 Grid": 2 }), verse({ "S-1 Grid": 2 })] });
  assert.deepEqual(Song.plan(song).parts["S-1 Grid"], [{ bar: 0, pattern: 2 }, { bar: 8, pattern: 2 }]);
});

test("TD-3 Grid plays its grid, a library pattern by id, or nothing", () => {
  const song = Song.cleanSong({ sections: [
    { name: "A", bars: 2, patterns: { "TD-3 Grid": "grid", "MPC Grid": 3 } },
    { name: "B", bars: 2, patterns: { "TD-3 Grid": "p1a2b3", "MPC Grid": 15 } },
    { name: "C", bars: 2, patterns: { "TD-3 Grid": 4, "MPC Grid": "grid" } },
  ] });
  assert.deepEqual(song.sections.map((item) => item.patterns["TD-3 Grid"]), ["grid", "p1a2b3", null]);
  assert.deepEqual(song.sections.map((item) => item.patterns["MPC Grid"]), [3, 15, null]);
  const plan = Song.plan(song);
  assert.deepEqual(Sync.songPart(plan, "TD-3 Grid").cues, [{ bar: 0, pattern: "grid" }, { bar: 2, pattern: "p1a2b3" }, { bar: 4, pattern: null }]);
  assert.deepEqual(Sync.songPart(plan, "MPC Grid").cues.map((cue) => cue.pattern), [3, 15, null]);
});

test("sections with Loop on repeat, as the plan tells every grid", () => {
  const song = Song.cleanSong({ sections: [{ name: "A", bars: 2 }, { name: "B", bars: 4, loop: true }, { name: "C", bars: 2 }] });
  assert.deepEqual(Song.bounds(song), [{ start: 0, end: 2 }, { start: 2, end: 6 }, { start: 6, end: 8 }]);
  const plan = Song.plan(song);
  assert.deepEqual(plan.loops, [{ start: 2, end: 6 }]);
  // A grid plays A, then B again and again.
  const part = Sync.songStart(Sync.songPart(plan, "S-1 Grid"));
  const heard = [part.bar];
  for (let i = 0; i < 11; i += 1) { Sync.songNextBar(part); heard.push(part.bar); }
  assert.deepEqual(heard, [0, 1, 2, 3, 4, 5, 2, 3, 4, 5, 2, 3]);
});

test("a song keeps the assets collected from each grid", () => {
  const song = Song.cleanSong({
    sections: [{ name: "A", bars: 4, patterns: { "S-1 Grid": 2, "TD-3 Grid": "pacid" } }],
    assets: {
      "S-1 Grid": {
        collected: "2026-11-21T10:00:00.000Z",
        patterns: [
          { id: "slot:2", ref: 2, label: "Pattern 3", length: "2 bars", notes: 12, data: { bars: 2, notes: [] } },
          { id: "slot:5", ref: 5, label: "Pattern 6", length: "1 bar", notes: 4, data: { bars: 1, notes: [] } },
          { id: "broken", label: "No data" },
        ],
        sound: { label: "The sound in S-1 Grid's controls", data: { values: { 74: 64 } } },
      },
      "TD-3 Grid": { patterns: [{ id: "td3:pacid", ref: "pacid", label: "Acid A", data: { steps: [] } }], sound: null },
      "Somewhere else": { patterns: [] },
    },
  });
  assert.deepEqual(Object.keys(song.assets), ["S-1 Grid", "TD-3 Grid"]);
  assert.deepEqual(song.assets["S-1 Grid"].patterns.map((item) => item.label), ["Pattern 3", "Pattern 6"]);
  assert.equal(Song.mainSound(song.assets["S-1 Grid"]).label, "The sound in S-1 Grid's controls", "a song saved with one sound keeps it");
  assert.equal(Song.mainSound(song.assets["TD-3 Grid"]), null);
  assert.equal(Song.usesPattern(song, "S-1 Grid", 2), true);
  assert.equal(Song.usesPattern(song, "S-1 Grid", 5), false);
  assert.equal(Song.usesPattern(song, "TD-3 Grid", "pacid"), true);
  assert.deepEqual(Song.newSong().assets, {});
});

test("patterns picked from a library go where the arrangement needs them", () => {
  const song = Song.cleanSong({ sections: [
    { name: "A", bars: 4, patterns: { "S-1 Grid": 3 } },
    { name: "B", bars: 4, patterns: { "S-1 Grid": 7 } },
  ] });
  const pattern = (id, ref = null) => ({ id, ref, label: id, length: "1 bar", notes: 1, data: { bars: 1, notes: [] } });
  // A pattern from slot 7 keeps its number. Library ones fill 3, then the first free.
  let result = Song.addAssets(song, "S-1 Grid", { patterns: [pattern("slot:7", 7), pattern("patch:Acid"), pattern("patch:Bell")] }, "t1");
  assert.deepEqual(result, { added: 3, full: 0 });
  assert.deepEqual(song.assets["S-1 Grid"].patterns.map((item) => [item.id, item.ref]), [["patch:Bell", 0], ["patch:Acid", 3], ["slot:7", 7]]);
  // Picking one again keeps it where it is. A pattern for a number already used replaces it.
  Song.addAssets(song, "S-1 Grid", { patterns: [pattern("patch:Acid"), pattern("slot:0", 0)], sound: { label: "Warm", data: { values: { 74: 9 } } } }, "t2");
  assert.deepEqual(song.assets["S-1 Grid"].patterns.map((item) => [item.id, item.ref]), [["slot:0", 0], ["patch:Acid", 3], ["slot:7", 7]]);
  assert.deepEqual(song.assets["S-1 Grid"].sounds.map((item) => item.label), ["Warm"]);
  assert.equal(song.assets["S-1 Grid"].collected, "t2");
  // Moving one swaps it with the pattern in the number it moves to.
  Song.moveAsset(song, "S-1 Grid", "patch:Acid", 7);
  assert.deepEqual(song.assets["S-1 Grid"].patterns.map((item) => [item.id, item.ref]), [["slot:0", 0], ["slot:7", 3], ["patch:Acid", 7]]);
  // Once every number holds a pattern, more don't fit.
  const many = Array.from({ length: 16 }, (_, index) => pattern(`p${index}`));
  result = Song.addAssets(song, "S-1 Grid", { patterns: many });
  assert.deepEqual(result, { added: 13, full: 3 });
  // TD-3 Grid's library patterns keep their ids as refs.
  Song.addAssets(song, "TD-3 Grid", { patterns: [{ ...pattern("td3:p1", "p1") }] });
  assert.deepEqual(song.assets["TD-3 Grid"].patterns.map((item) => item.ref), ["p1"]);
});

test("a section's tempo, transpose, fill and preset reach the grids in their cues", () => {
  const song = Song.cleanSong({ bpm: 120, sections: [
    { name: "A", bars: 4, patterns: { "S-1 Grid": 0, "MPC Grid": 1, "TD-3 Grid": "grid" }, transpose: 3, fills: { "S-1 Grid": 5, "MPC Grid": 2 }, programs: { "S-1 Grid": 9, "MPC Grid": 4 } },
    { name: "B", bars: 1, patterns: { "S-1 Grid": 1 }, bpm: 128, fills: { "S-1 Grid": 7 } },
  ] });
  assert.equal(song.sections[0].bpm, null);
  assert.deepEqual(song.sections[0].programs, { "S-1 Grid": 9 }, "the MPC has no presets to pick");
  const plan = Song.plan(song, { mutes: ["MPC Grid"] });
  assert.deepEqual(plan.parts["S-1 Grid"], [
    { bar: 0, pattern: 0, bpm: 120, transpose: 3, program: 9 },
    { bar: 3, pattern: 5, transpose: 3 },
    { bar: 4, pattern: 1, bpm: 128 },
  ], "a one-bar section has no room for a fill");
  assert.deepEqual(plan.parts["MPC Grid"], [{ bar: 0, pattern: 1, bpm: 120 }, { bar: 3, pattern: 2 }, { bar: 4, pattern: null, bpm: 128 }], "drums aren't transposed");
  assert.deepEqual(plan.parts["TD-3 Grid"][0], { bar: 0, pattern: "grid", bpm: 120, transpose: 3 });
  assert.equal(Song.startBpm(song), 120);
  // Each grid reads its part, and whether it's muted, through sync.js.
  const mpc = Sync.songStart(Sync.songPart(plan, "MPC Grid"));
  assert.equal(Sync.songSilenced(mpc), true);
  const s1 = Sync.songStart(Sync.songPart(plan, "S-1 Grid"));
  assert.equal(Sync.songSilenced(s1), false);
  s1.moves.push(Sync.songMove({ atBar: 1, mutes: ["S-1 Grid"] }, plan.bars));
  Sync.songNextBar(s1);
  assert.equal(Sync.songSilenced(s1), true);
});

test("warnings point out patterns the song plays but doesn't keep", () => {
  const song = Song.cleanSong({
    sections: [{ name: "Verse", bars: 4, patterns: { "S-1 Grid": 2, "Protein Grid": 0, "TD-3 Grid": "gone" }, fills: { "S-1 Grid": 3 } }],
    assets: { "S-1 Grid": { patterns: [{ id: "slot:2", ref: 2, label: "Pattern 3", data: { bars: 1, notes: [] } }] } },
  });
  const texts = Song.warnings(song, [{ id: "here", name: "Here" }]).map((item) => item.text);
  assert.deepEqual(texts, [
    'S-1 plays pattern 4 as its fill in "Verse", which isn\'t kept with the song.',
    'TD-3 pattern in "Verse" isn\'t in TD-3 Grid\'s library.',
  ]);
});

test("a song exports as a MIDI file, with a track for each grid", () => {
  const song = Song.cleanSong({
    name: "Demo", bpm: 120,
    sections: [
      { name: "A", bars: 2, patterns: { "S-1 Grid": 0, "TD-3 Grid": "grid", "MPC Grid": 4 }, transpose: 2 },
      { name: "B", bars: 1, patterns: { "S-1 Grid": 0 }, bpm: 90 },
    ],
    assets: {
      "S-1 Grid": { patterns: [{ id: "slot:0", ref: 0, label: "Pattern 1", data: { bars: 1, notes: [{ note: 60, time: 0, length: 960, velocity: 1 }] } }] },
      "TD-3 Grid": { patterns: [{ id: "td3:grid", ref: "grid", label: "Grid", data: { length: 2, triplet: false, steps: [{ kind: "note", note: 0, octave: 0 }, { kind: "tie" }] } }] },
    },
  });
  const { bytes, missing } = Song.toMidi(song);
  assert.deepEqual(missing, ["MPC sequence 5"]);
  const ascii = (from, count) => String.fromCharCode(...bytes.slice(from, from + count));
  assert.equal(ascii(0, 4), "MThd");
  assert.equal(bytes[11], 3, "a conductor track, then S-1 and TD-3");
  // Read every note-on back, with its time, from each track.
  const tracks = [];
  let at = 14;
  while (at < bytes.length) {
    assert.equal(ascii(at, 4), "MTrk");
    const size = (bytes[at + 4] << 24) | (bytes[at + 5] << 16) | (bytes[at + 6] << 8) | bytes[at + 7];
    const data = bytes.slice(at + 8, at + 8 + size);
    const ons = [];
    const tempos = [];
    let i = 0;
    let time = 0;
    while (i < data.length) {
      let delta = 0;
      do { delta = (delta << 7) | (data[i] & 0x7F); } while (data[i++] & 0x80);
      time += delta;
      const status = data[i];
      if (status === 0xFF) {
        if (data[i + 1] === 0x51) tempos.push([time, Math.round(60000000 / ((data[i + 3] << 16) | (data[i + 4] << 8) | data[i + 5]))]);
        i += 3 + data[i + 2];
      } else {
        if ((status & 0xF0) === 0x90) ons.push([time, data[i + 1]]);
        i += (status & 0xF0) === 0xC0 ? 2 : 3;
      }
    }
    tracks.push({ ons, tempos });
    at += 8 + size;
  }
  assert.deepEqual(tracks[0].tempos, [[0, 120], [7680, 90]]);
  assert.deepEqual(tracks[1].ons, [[0, 62], [3840, 62], [7680, 60]], "S-1 repeats its bar, transposed in A");
  assert.deepEqual(tracks[2].ons, [[0, 38], [480, 38], [960, 38], [1440, 38], [1920, 38], [2400, 38], [2880, 38], [3360, 38], [3840, 38], [4320, 38], [4800, 38], [5280, 38], [5760, 38], [6240, 38], [6720, 38], [7200, 38]], "TD-3's two-step pattern repeats through A");
});

test("a performance becomes a song of the sections as they played", () => {
  const song = Song.cleanSong({ name: "Live", sections: [{ name: "A", bars: 2 }, { name: "B", bars: 4, loop: true }] });
  const take = Song.fromSections(song, [0, 1, 1, 0, 7], "Live take");
  assert.equal(take.name, "Live take");
  assert.deepEqual(take.sections.map((item) => [item.name, item.loop]), [["A", false], ["B", false]], "each part once");
  assert.deepEqual(Song.expand(take).sections.map((item) => [item.name, item.loop]), [["A", false], ["B", false], ["B", false], ["A", false]]);
  assert.equal(new Set(take.order.map((item) => item.id)).size, 4);
});

test("a song saved before the arranger plays its parts once each, in order", () => {
  const song = Song.cleanSong({ sections: [{ id: "a", name: "A", bars: 2 }, { id: "b", name: "B", bars: 4 }] });
  assert.deepEqual(song.order.map((item) => item.part), ["a", "b"]);
  assert.equal(Song.totalBars(song), 6);
  assert.ok(song.sections.every((item) => Number.isInteger(item.colour)), "every part gets a colour");
  assert.notEqual(song.sections[0].colour, song.sections[1].colour);
});

test("the arrangement plays parts in its own order, any number of times", () => {
  const song = Song.cleanSong({
    sections: [{ id: "v", name: "Verse", bars: 8, patterns: { "S-1 Grid": 1 } }, { id: "c", name: "Chorus", bars: 4, patterns: { "S-1 Grid": 2 }, loop: true }],
    order: [{ id: "1", part: "c" }, { id: "2", part: "v" }, { id: "3", part: "c" }, { id: "x", part: "gone" }, { id: "1", part: "v" }],
  });
  assert.equal(song.order.length, 4, "a block of a part the song hasn't is dropped");
  assert.equal(new Set(song.order.map((item) => item.id)).size, 4, "a repeated block id is replaced");
  assert.equal(Song.totalBars(song), 24);
  assert.deepEqual(Song.plan(song).parts["S-1 Grid"].map((cue) => [cue.bar, cue.pattern]), [[0, 2], [4, 1], [12, 2], [16, 1]]);
  assert.deepEqual(Song.bounds(song)[2], { start: 12, end: 16 });
  assert.deepEqual(Song.loops(song), [{ start: 0, end: 4 }, { start: 12, end: 16 }]);
  assert.deepEqual(Song.sectionAt(song, 13), { index: 2, bar: 1 });
  const played = Song.expand(song);
  assert.equal(played.sections[2].part, "c");
  assert.equal(played.sections[2].id, song.order[2].id);
  assert.equal(Song.expand(played), played);
  assert.equal(Song.seconds(song), 48);
  assert.equal(Song.cleanSong({ ...JSON.parse(JSON.stringify(song)), order: [] }).order.length, 0, "an empty arrangement stays empty");
});

test("Bass Station and Protein keep several sounds, and the others one", () => {
  const song = Song.cleanSong({});
  const sound = (label) => ({ id: `lib:${label}`, label, data: { values: { 1: label.length } } });
  Song.addAssets(song, "Bass Station Grid", { sounds: [sound("Sub"), sound("Wobble")] });
  Song.addAssets(song, "Bass Station Grid", { sound: sound("Pluck") });
  Song.addAssets(song, "Bass Station Grid", { sounds: [{ ...sound("Sub"), data: { values: { 1: 99 } } }] });
  const kept = song.assets["Bass Station Grid"];
  assert.deepEqual(kept.sounds.map((item) => item.label), ["Sub", "Wobble", "Pluck"], "one with the same name is replaced where it was");
  assert.equal(kept.sounds[0].data.values[1], 99);
  assert.equal(Song.mainSound(kept).label, "Sub");
  Song.makeMainSound(song, "Bass Station Grid", kept.sounds[2].id);
  assert.deepEqual(song.assets["Bass Station Grid"].sounds.map((item) => item.label), ["Pluck", "Sub", "Wobble"]);
  Song.addAssets(song, "S-1 Grid", { sounds: [sound("A"), sound("B")] });
  assert.deepEqual(song.assets["S-1 Grid"].sounds.map((item) => item.label), ["B"]);
  const again = Song.cleanSong(JSON.parse(JSON.stringify(song)));
  assert.deepEqual(again.assets["Bass Station Grid"].sounds.map((item) => item.label), ["Pluck", "Sub", "Wobble"]);
});
