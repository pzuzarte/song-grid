"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const LibraryTags = require("../library-tags.js");

test("tags are tidied: trimmed, each once, ignoring capitals", () => {
  assert.deepEqual(LibraryTags.parse(" Dark,bass ,  dark, ,Big   room "), ["Dark", "bass", "Big room"]);
  assert.deepEqual(LibraryTags.of({ tags: ["a", "b"] }), ["a", "b"], "a list works too");
  assert.deepEqual(LibraryTags.of(null), []);
  assert.equal(LibraryTags.parse(Array.from({ length: 20 }, (_, index) => `t${index}`).join(",")).length, 12);
});

test("an info entry keeps only what's set", () => {
  assert.equal(LibraryTags.tidy({ favourite: false, tags: " , " }), null);
  assert.deepEqual(LibraryTags.tidy({ favourite: true, tags: "x,X, y", id: "p1" }), { favourite: true, tags: "x, y", id: "p1" });
});

test("filtering by favourites, tags and words", () => {
  const filter = LibraryTags.filter();
  const acid = { favourite: true, tags: "Acid, dark" };
  const pad = { tags: "pad" };
  assert.ok(LibraryTags.matches(filter, "Anything", null));
  filter.tags = ["dark"];
  assert.ok(LibraryTags.matches(filter, "Squelch", acid));
  assert.ok(!LibraryTags.matches(filter, "Warm", pad));
  filter.tags = [];
  filter.favourites = true;
  assert.ok(!LibraryTags.matches(filter, "Warm", pad));
  filter.favourites = false;
  filter.words = "acid squ";
  assert.ok(LibraryTags.matches(filter, "Squelch", acid), "words are found in the name and the tags");
  assert.ok(!LibraryTags.matches(filter, "Warm", pad));
  filter.words = "bars";
  assert.ok(LibraryTags.matches(filter, "Warm", pad, "4 bars"), "and in extra text");
});

test("the tags in use, most used first", () => {
  const counts = LibraryTags.counts([{ tags: "Dark, bass" }, { tags: "dark" }, null, { tags: "acid" }]);
  assert.deepEqual(counts.map((entry) => [entry.tag, entry.count]), [["Dark", 2], ["acid", 1], ["bass", 1]]);
});
