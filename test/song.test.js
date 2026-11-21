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
