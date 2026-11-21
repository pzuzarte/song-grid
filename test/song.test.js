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
    assert.deepEqual(Object.values(item.patterns), [0, 0, 0]);
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
  assert.deepEqual(Sync.songPart(plan, "S-1 Grid"), { bars: 14, loop: true, cues: [{ bar: 0, pattern: 0 }, { bar: 4, pattern: 1 }, { bar: 12, pattern: 0 }] });
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
  assert.equal(song.sections[0].patterns["Bass Station Grid"], 0);
  assert.notEqual(song.sections[0].id, song.sections[1].id);
  assert.deepEqual(Song.cleanSong(null).sections.length, 2);
  assert.deepEqual(Song.cleanSong({ sections: [] }).sections.length, 2);
});

test("copies of one section play the same patterns", () => {
  const song = Song.cleanSong({ sections: [verse({ "S-1 Grid": 2 }), verse({ "S-1 Grid": 2 })] });
  assert.deepEqual(Song.plan(song).parts["S-1 Grid"], [{ bar: 0, pattern: 2 }, { bar: 8, pattern: 2 }]);
});
