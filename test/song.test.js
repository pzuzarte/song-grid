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
  assert.deepEqual(Sync.songPart(plan, "S-1 Grid"), { bars: 14, loop: true, cues: [{ bar: 0, pattern: 0 }, { bar: 4, pattern: 1 }, { bar: 12, pattern: 0 }], loops: [] });
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
  assert.equal(song.assets["S-1 Grid"].sound.label, "The sound in S-1 Grid's controls");
  assert.equal(song.assets["TD-3 Grid"].sound, null);
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
  assert.equal(song.assets["S-1 Grid"].sound.label, "Warm");
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
