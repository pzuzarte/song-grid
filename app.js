"use strict";
/* Song Grid: arranges the grids' patterns into sections and plays them as a song. It makes
   no sound itself. Through sync.js it sends each open grid its part of the song, then
   starts them together, and shows where the song has got to. The song model is in song.js. */

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "song-grid";
const SONGS_KEY = "song-grid-songs";
const THEME_KEY = "song-grid-theme";
const PPQ = 960; // Pulses to a beat, as the grids count them.
const BAR_PULSES = PPQ * 4;

let song = Song.newSong();
let songId = null; // The saved song this one was opened from or saved as.
let songs = [];
let peers = [];
// While playing: when bar 0 started, in performance.now() time, and the tempo since then.
// sim follows the song the way each grid does (see sync.js), so this page knows which bar
// is playing however the song has moved. played is the song as it was when Play was pressed.
const playback = { on: false, anchorTime: 0, anchorPulse: 0, bpm: 120, timer: null, played: null, sim: null, queued: null };
const MOVE_NOTICE_MS = 250; // Time for a move to reach every grid before its bar starts.

/* ---------- Saving in the browser ---------- */

function readJson(key, fallback) {
  try {
    const text = localStorage.getItem(key);
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback; // Private windows can refuse storage.
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    setStatus("The browser wouldn't save. Back up your songs to keep them.", true);
  }
}

const save = () => writeJson(STORAGE_KEY, { song, songId });

function restore() {
  const saved = readJson(STORAGE_KEY, {});
  song = Song.cleanSong(saved.song);
  songId = typeof saved.songId === "string" ? saved.songId : null;
  songs = cleanSongs(readJson(SONGS_KEY, []));
}

const newId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function cleanSongs(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && typeof item === "object").map((item) => ({
    id: typeof item.id === "string" ? item.id : newId(),
    song: Song.cleanSong(item.song),
    saved: typeof item.saved === "string" ? item.saved : new Date().toISOString(),
  }));
}

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

/* ---------- The arrangement ---------- */

// Every change to the song goes through here.
function change(edit) {
  edit(song);
  save();
  render();
}

// TD-3 Grid keeps its patterns in its library, in this browser, which this page shares.
function td3Library() {
  const items = readJson("td3-grid-library", []);
  return Array.isArray(items) ? items.filter((item) => item && typeof item.id === "string" && typeof item.name === "string") : [];
}

function patternSelect(item, instrument) {
  const { name } = instrument;
  const select = document.createElement("select");
  const value = item.patterns[name];
  if (instrument.library) {
    const saved = td3Library();
    select.append(new Option("Off", ""), new Option("Grid pattern", Song.GRID),
      ...saved.map((entry) => new Option(entry.name, entry.id)));
    if (value && value !== Song.GRID && !saved.some((entry) => entry.id === value)) {
      select.append(new Option("(not in the library)", value));
    }
  } else {
    const word = instrument.word || "Pattern";
    select.append(new Option("Off", ""), ...Array.from({ length: Song.PATTERNS }, (_, index) => new Option(`${word} ${index + 1}`, String(index))));
  }
  select.value = value === null ? "" : String(value);
  select.classList.toggle("off", value === null);
  select.setAttribute("aria-label", `${name} in ${item.name}`);
  select.title = instrument.library ? "The pattern in TD-3 Grid, or one from its library, or Off" : "";
  select.onchange = () => change(() => {
    if (select.value === "") item.patterns[name] = null;
    else item.patterns[name] = instrument.library ? select.value : Number(select.value);
  });
  return select;
}

// An infinity sign with an arrow, for Loop, and two chevrons, for Up next.
const ICONS = {
  loop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c-1.8-2.4-3.3-4-5.5-4a4 4 0 0 0 0 8c2.2 0 3.7-1.6 5.5-4s3.3-4 5.5-4a4 4 0 0 1 0 8c-2.2 0-3.7-1.6-5.5-4z"/><path d="M15 6.2l2.7 1.7-1.5 2.8"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6l6 6-6 6M12 6l6 6-6 6"/></svg>',
};

function iconButton(icon, label, title, pressed, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.innerHTML = ICONS[icon];
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(pressed));
  button.title = title;
  button.onclick = onClick;
  return button;
}

function toolButton(text, title, onClick, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.title = title;
  button.disabled = disabled;
  button.onclick = onClick;
  return button;
}

function moveSection(index, by) {
  change((target) => {
    const [item] = target.sections.splice(index, 1);
    target.sections.splice(index + by, 0, item);
  });
}

function copySection(index) {
  if (song.sections.length >= Song.MAX_SECTIONS) {
    setStatus(`A song can have up to ${Song.MAX_SECTIONS} sections.`, true);
    return;
  }
  change((target) => {
    const copy = Song.section({ ...JSON.parse(JSON.stringify(target.sections[index])), id: undefined });
    target.sections.splice(index + 1, 0, copy);
  });
}

function deleteSection(index) {
  if (song.sections.length === 1) {
    setStatus("A song needs at least one section.", true);
    return;
  }
  const { name } = song.sections[index];
  change((target) => target.sections.splice(index, 1));
  setStatus(`Deleted "${name}".`);
}

function render() {
  $("song-name").value = song.name;
  $("bpm").value = String(playback.on ? playback.bpm : song.bpm);
  $("loop").checked = song.loop;
  $("total").textContent = `${song.sections.length} section${song.sections.length === 1 ? "" : "s"}, ${Song.totalBars(song)} bars`;

  const table = $("table");
  const rows = [];
  const count = song.sections.length;

  const tools = document.createElement("tr");
  tools.append(document.createElement("th"));
  const names = document.createElement("tr");
  names.append(Object.assign(document.createElement("th"), { textContent: "Section" }));
  const bars = document.createElement("tr");
  bars.append(Object.assign(document.createElement("th"), { textContent: "Bars" }));
  song.sections.forEach((item, index) => {
    const cell = document.createElement("td");
    cell.className = "section-tools";
    cell.dataset.section = String(index);
    cell.append(
      toolButton("<", "Move this section left", () => moveSection(index, -1), index === 0),
      toolButton(">", "Move this section right", () => moveSection(index, 1), index === count - 1),
      toolButton("Copy", "Add a copy of this section after it", () => copySection(index)),
      toolButton("Del", "Delete this section", () => deleteSection(index)),
    );

    tools.append(cell);

    const nameCell = document.createElement("td");
    nameCell.dataset.section = String(index);
    const name = document.createElement("input");
    name.type = "text";
    name.maxLength = 30;
    name.value = item.name;
    name.setAttribute("aria-label", `Section ${index + 1} name`);
    name.onchange = () => change(() => { item.name = name.value.trim() || `Section ${index + 1}`; });
    nameCell.append(name);
    names.append(nameCell);

    const barsCell = document.createElement("td");
    barsCell.dataset.section = String(index);
    const select = document.createElement("select");
    const choices = Song.BAR_CHOICES.includes(item.bars) ? Song.BAR_CHOICES : [...Song.BAR_CHOICES, item.bars].sort((a, b) => a - b);
    select.append(...choices.map((value) => new Option(`${value} bar${value === 1 ? "" : "s"}`, String(value))));
    select.value = String(item.bars);
    select.setAttribute("aria-label", `${item.name} length`);
    select.onchange = () => change(() => { item.bars = Number(select.value); });
    barsCell.append(select);
    bars.append(barsCell);
  });
  // Loop and Up next for each section, and how far through it the song is.
  const play = document.createElement("tr");
  play.append(Object.assign(document.createElement("th"), { textContent: "Play" }));
  song.sections.forEach((item, index) => {
    const cell = document.createElement("td");
    cell.className = "section-play";
    cell.dataset.section = String(index);
    const queued = playback.queued?.index === index;
    const loop = iconButton("loop", `Loop ${item.name}`,
      item.loop ? "Looping: this section repeats each time it's reached. Click to stop it looping." : "Loop: repeat this section each time it's reached, until you click again",
      item.loop, () => toggleLoop(index));
    const next = iconButton("next", `Play ${item.name} next`,
      queued ? "Up next: plays when the section playing finishes. Click to cancel." : "Up next: play this section when the one playing finishes",
      queued, () => queueSection(index));
    next.disabled = !playback.on;
    const progress = document.createElement("div");
    progress.className = "progress";
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", `${item.name} progress`);
    progress.append(Object.assign(document.createElement("div"), { className: "fill" }));
    const label = Object.assign(document.createElement("span"), { className: "progress-label" });
    const inner = Object.assign(document.createElement("div"), { className: "play-cell" });
    inner.append(loop, next, label, progress);
    cell.append(inner);
    play.append(cell);
  });
  rows.push(tools, names, bars, play);

  for (const instrument of Song.INSTRUMENTS) {
    const row = document.createElement("tr");
    const open = peers.includes(instrument.name);
    row.classList.toggle("closed", !open);
    const label = document.createElement("th");
    label.className = "instrument";
    label.textContent = instrument.label;
    const note = document.createElement("small");
    if (open) {
      note.textContent = "Linked";
    } else {
      const link = document.createElement("a");
      link.href = instrument.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Not open";
      link.title = `Open ${instrument.name}, and tick Sync`;
      note.append(link);
    }
    label.append(note);
    row.append(label);
    song.sections.forEach((item, index) => {
      const cell = document.createElement("td");
      cell.dataset.section = String(index);
      cell.append(patternSelect(item, instrument));
      row.append(cell);
    });
    rows.push(row);
  }
  table.replaceChildren(...rows);
  renderPlaying();
  renderAssets();
  renderSongs();
}

/* ---------- Playing ---------- */

const msPerPulse = () => 60000 / (playback.bpm * PPQ);
const pulseAt = (time) => playback.anchorPulse + (time - playback.anchorTime) / msPerPulse();

// Section starts and ends, in bars, for the song that's playing.
function sectionBounds(target, index) {
  let start = 0;
  for (let i = 0; i < index; i += 1) start += target.sections[i].bars;
  return { start, end: start + target.sections[index].bars };
}

function renderPlaying() {
  $("play").textContent = playback.on ? "Stop" : "Play";
  $("play").setAttribute("aria-pressed", String(playback.on));
  for (const id of ["section-back", "section-next"]) $(id).disabled = !playback.on;
  let current = null;
  let text = "";
  if (playback.on) {
    const target = playback.played;
    const total = Song.totalBars(target);
    const at = Song.sectionAt(target, playback.sim.bar);
    current = at ? at.index : null;
    if (at) {
      text = `Bar ${playback.sim.bar + 1} of ${total}: ${target.sections[at.index].name}, bar ${at.bar + 1}`;
      if (target.sections[at.index].loop) text += ", looping";
      if (playback.queued) text += `. Next: ${target.sections[playback.queued.index].name}`;
    }
  }
  $("position").textContent = text;
  document.querySelectorAll("#table td").forEach((cell) => {
    cell.classList.toggle("playing", current !== null && Number(cell.dataset.section) === current);
  });
  renderProgress();
}

// Fills the bar under the section playing, as far through it as the song is.
function renderProgress() {
  let index = null;
  let done = 0;
  let text = "";
  if (playback.on) {
    const at = Song.sectionAt(playback.played, playback.sim.bar);
    if (at) {
      index = at.index;
      const bars = playback.played.sections[at.index].bars;
      const inBar = (pulseAt(performance.now()) % BAR_PULSES) / BAR_PULSES;
      done = Math.min(1, (at.bar + Math.max(0, inBar)) / bars);
      text = `${at.bar + 1}/${bars}`;
    }
  }
  document.querySelectorAll(".section-play").forEach((cell) => {
    const here = index !== null && Number(cell.dataset.section) === index;
    cell.querySelector(".fill").style.width = `${here ? done * 100 : 0}%`;
    cell.querySelector(".progress").setAttribute("aria-valuenow", String(here ? Math.round(done * 100) : 0));
    cell.querySelector(".progress-label").textContent = here ? text : "";
  });
}

function animate() {
  if (!playback.on) return;
  renderProgress();
  requestAnimationFrame(animate);
}

function tick() {
  if (!playback.on) return;
  const played = Math.floor(pulseAt(performance.now()) / BAR_PULSES);
  // The grids stop themselves at the end, so this page only catches up.
  while (playback.sim.played < played) {
    if (!Sync.songNextBar(playback.sim)) {
      stopPlaying();
      setStatus("The song has ended.");
      return;
    }
  }
  if (playback.queued && playback.sim.played >= playback.queued.atBar) {
    playback.queued = null;
    render();
    return;
  }
  renderPlaying();
}

// The first bar a move can safely happen on: the next one, or the one after if the next
// starts too soon for the move to reach every grid.
function nextSafeBar() {
  const now = performance.now();
  const played = Math.floor(pulseAt(now) / BAR_PULSES);
  const nextStart = playback.anchorTime + ((played + 1) * BAR_PULSES - playback.anchorPulse) * msPerPulse();
  return played + (nextStart - now < MOVE_NOTICE_MS ? 2 : 1);
}

function sendMove(data) {
  const move = Sync.songMove(data, playback.sim.bars);
  if (!move) return;
  link.announceSongMove(move);
  playback.sim.moves.push(move);
}

// The song bar that will be playing as a bar of playback starts, if nothing else moves it.
function barAt(atBar) {
  const look = JSON.parse(JSON.stringify(playback.sim));
  while (look.played < atBar - 1) if (!Sync.songNextBar(look)) return null;
  return look.bar;
}

// Jumps a section back or forward from the one playing, on the next bar.
function skipSection(by) {
  if (!playback.on) return;
  const target = playback.played;
  const atBar = nextSafeBar();
  const bar = barAt(atBar);
  if (bar === null) return;
  const { index } = Song.sectionAt(target, bar);
  let to = index + by;
  if (to >= target.sections.length) {
    if (!target.loop) {
      setStatus("That's the last section. Turn on Loop to go round to the first.", true);
      return;
    }
    to = 0;
  }
  to = Math.max(0, to);
  sendMove({ atBar, toBar: sectionBounds(target, to).start });
  playback.queued = null;
  render();
  setStatus(`Jumping to "${target.sections[to].name}" on the next bar.`);
}

// Turns a section's Loop on or off. While the song plays, every grid changes on the next bar.
function toggleLoop(index) {
  const item = song.sections[index];
  change(() => { item.loop = !item.loop; });
  if (!playback.on) return;
  const played = playback.played.sections.find((section) => section.id === item.id);
  if (!played) return;
  played.loop = item.loop;
  sendMove({ atBar: nextSafeBar(), loops: Song.loops(playback.played) });
  setStatus(item.loop ? `"${item.name}" loops until you click its loop button again.` : `"${item.name}" stops looping, and the song carries on after it.`);
  renderPlaying();
}


// The section playing, and the bar of playback its run through ends on: where a looped
// section goes round again, or the song moves on.
function runEnd() {
  const target = playback.played;
  const playing = Song.sectionAt(target, playback.sim.bar);
  const { end } = sectionBounds(target, playing.index);
  return { playing, atBar: Math.max(nextSafeBar(), playback.sim.played + (end - playback.sim.bar)) };
}

// Queues a section to play when the one playing has run through, or cancels it.
function queueSection(index) {
  if (!playback.on) return;
  const target = playback.played;
  if (playback.queued?.index === index) {
    // What would have happened without it: the looped section again, or the next one.
    const { atBar, move } = playback.queued;
    playback.sim.moves = playback.sim.moves.filter((item) => item !== move);
    const natural = barAt(atBar);
    if (natural === null) {
      playback.sim.moves.push(move);
      setStatus("It's too late to cancel, as the song ends there.", true);
      return;
    }
    sendMove({ atBar, toBar: natural });
    playback.queued = null;
    render();
    setStatus("Cancelled.");
    return;
  }
  if (playback.queued) queueSection(playback.queued.index);
  const { playing, atBar } = runEnd();
  sendMove({ atBar, toBar: sectionBounds(target, index).start });
  playback.queued = { index, atBar, move: playback.sim.moves[playback.sim.moves.length - 1] };
  render();
  setStatus(`Up next: "${target.sections[index].name}", when "${target.sections[playing.index].name}" finishes.`);
}

function startPlaying() {
  if (!peers.some((name) => Song.INSTRUMENTS.some((item) => item.name === name))) {
    setStatus("Open the grids in this browser, with Sync ticked, to play the song.", true);
    return;
  }
  const plan = Song.plan(song);
  link.announceSong(plan);
  const at = link.announcePlay(song.bpm);
  if (at === null) {
    setStatus("Couldn't reach the grids. Reload this page and try again.", true);
    return;
  }
  Object.assign(playback, {
    on: true, anchorTime: at, anchorPulse: 0, bpm: song.bpm, queued: null,
    played: JSON.parse(JSON.stringify(song)), sim: Sync.songStart({ bars: plan.bars, loop: plan.loop, loops: plan.loops }),
  });
  clearInterval(playback.timer);
  playback.timer = setInterval(tick, 100);
  render();
  requestAnimationFrame(animate);
  const playing = Song.INSTRUMENTS.filter((item) => peers.includes(item.name)).map((item) => item.label);
  setStatus(`Playing "${song.name || "Untitled"}" on ${playing.join(", ")}.`);
}

function stopPlaying() {
  playback.on = false;
  playback.queued = null;
  clearInterval(playback.timer);
  $("bpm").value = String(song.bpm);
  render();
}

function togglePlay() {
  if (playback.on) {
    link.announceStop();
    stopPlaying();
    setStatus("Stopped.");
  } else {
    startPlaying();
  }
}

// A tempo change mid-song carries on from the same point at the new speed.
function retime(bpm, time = performance.now()) {
  const pulse = pulseAt(time);
  Object.assign(playback, { anchorTime: time, anchorPulse: pulse, bpm });
}

function renderPeers(names) {
  peers = names;
  const pill = $("peers");
  pill.textContent = names.length ? `Linked: ${names.join(", ")}` : "Not linked";
  pill.className = `pill ${names.length ? "ok" : ""}`;
  pill.title = names.length ? "These grids follow the song." : "Open the grids in this browser, with Sync ticked.";
  render();
}

// Song Grid is always linked, as playing the grids is all it does.
const syncBox = document.createElement("input");
syncBox.type = "checkbox";
const link = Sync.connect({
  name: "Song Grid",
  checkbox: syncBox,
  storageKey: "song-grid-sync",
  // A grid started on its own plays without the song, so this page just carries on.
  start: () => true,
  stop() {
    if (!playback.on) return;
    stopPlaying();
    setStatus("Stopped from a grid.");
  },
  tempo({ bpm }) {
    if (playback.on) retime(bpm);
    $("bpm").value = String(bpm);
  },
  // Each grid says when it has joined in, which the line about the song already covers.
  status: (message, isError) => { if (isError || !message.startsWith("Playing with")) setStatus(message, isError); },
  peers: renderPeers,
  assetsReceived,
  assetsLoaded,
});
syncBox.checked = true;

/* ---------- Assets ---------- */

// A collection under way: its request id, the grids asked, and which have answered.
let collecting = null;
const COLLECT_WAIT_MS = 4000;
const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");

function collect(names) {
  const asked = names.filter((name) => peers.includes(name));
  if (!asked.length) {
    setStatus("Open the grids in this browser, with Sync ticked, to collect from them.", true);
    return;
  }
  const request = link.requestAssets();
  if (!request) return;
  clearTimeout(collecting?.timer);
  collecting = { request, asked: new Set(asked), answered: new Set() };
  collecting.timer = setTimeout(() => {
    const missing = [...collecting.asked].filter((name) => !collecting.answered.has(name));
    if (missing.length) setStatus(`${missing.join(" and ")} didn't answer. Hard-refresh ${missing.length === 1 ? "it" : "them"} to load the latest version, then collect again.`, true);
    collecting = null;
    renderAssets();
  }, COLLECT_WAIT_MS);
  renderAssets();
  setStatus(`Collecting from ${asked.join(", ")}...`);
}

function assetsReceived(from, assets, request) {
  if (!collecting || request !== collecting.request || !collecting.asked.has(from)) return;
  collecting.answered.add(from);
  const kept = Song.cleanAssets({ [from]: { ...assets, collected: new Date().toISOString() } })[from];
  if (kept) change(() => { song.assets[from] = kept; });
  const label = Song.INSTRUMENTS.find((item) => item.name === from)?.label || from;
  setStatus(`Collected ${kept?.patterns.length || 0} pattern${kept?.patterns.length === 1 ? "" : "s"}${kept?.sound ? " and the sound" : ""} from ${label}.`);
  if (collecting.answered.size === collecting.asked.size) {
    clearTimeout(collecting.timer);
    collecting = null;
    renderAssets();
  }
}

// Assets being put back into the grids: which request went to which grid, and what each said.
let loading = null;
const LOAD_WAIT_MS = 10000; // Bass Station Grid sends its sound through its editor, which can take a few seconds.
const labelOf = (name) => Song.INSTRUMENTS.find((item) => item.name === name)?.label || name;
const hasAssets = (name) => Boolean(song.assets[name] && (song.assets[name].patterns.length || song.assets[name].sound));
const joinNames = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join(""));

// Puts a song's assets back into grids. only, for one grid, sends just those assets.
function loadInto(names, only = null) {
  const targets = names.filter((name) => peers.includes(name) && hasAssets(name));
  if (!targets.length) {
    setStatus(names.some(hasAssets) ? "Open the grids in this browser, with Sync ticked, to put the assets back into them." : "This song has no assets to put back. Collect them first.", true);
    return;
  }
  clearTimeout(loading?.timer);
  loading = { requests: new Map(), results: new Map() };
  for (const name of targets) {
    const { patterns, sound } = only || song.assets[name];
    const request = link.sendAssets(name, { patterns, sound });
    if (request) loading.requests.set(request, name);
  }
  if (!loading.requests.size) {
    loading = null;
    return;
  }
  loading.timer = setTimeout(finishLoading, LOAD_WAIT_MS);
  renderAssets();
  setStatus(only ? `Putting ${only.sound ? only.sound.label : only.patterns[0]?.label} into ${labelOf(targets[0])}...` : `Putting this song's assets back into ${joinNames(targets.map(labelOf))}...`);
}

function assetsLoaded(from, result, request) {
  if (!loading || loading.requests.get(request) !== from) return;
  loading.results.set(from, result);
  if (loading.results.size === loading.requests.size) finishLoading();
  else renderAssets();
}

// Says how it went once every grid has answered, or the wait is over.
function finishLoading() {
  if (!loading) return;
  clearTimeout(loading.timer);
  const asked = [...loading.requests.values()];
  const done = asked.filter((name) => loading.results.get(name)?.ok);
  const problems = asked.filter((name) => loading.results.has(name) && !loading.results.get(name).ok)
    .map((name) => `${labelOf(name)}: ${loading.results.get(name).message}`);
  const silent = asked.filter((name) => !loading.results.has(name));
  loading = null;
  renderAssets();
  const parts = [];
  if (done.length) parts.push(`Put the assets back into ${joinNames(done.map(labelOf))}. Undo in a grid brings back its patterns as they were.`);
  parts.push(...problems);
  if (silent.length) parts.push(`${joinNames(silent.map(labelOf))} didn't answer. Hard-refresh ${silent.length === 1 ? "it" : "them"} to load the latest version, then try again.`);
  setStatus(parts.join(" "), problems.length > 0 || silent.length > 0);
}

/* ---------- Picking assets from a grid ---------- */

// The grid being picked from, what it offered, and what's ticked.
let picker = null;
const PICKER_SHOWN = 300; // Rows shown per list; searching narrows a long library.

async function openPicker(name) {
  picker = { name, catalog: null, error: "", search: "", favourites: false, ticked: new Set(), sound: "", busy: false };
  $("picker-title").textContent = `Add from ${labelOf(name)}`;
  $("picker-search").value = "";
  renderPicker();
  $("picker").showModal();
  try {
    const catalog = await link.ask(name, "catalog");
    if (picker?.name !== name) return;
    picker.catalog = {
      grid: Array.isArray(catalog?.grid) ? catalog.grid : [],
      patterns: Array.isArray(catalog?.patterns) ? catalog.patterns : [],
      sounds: Array.isArray(catalog?.sounds) ? catalog.sounds : [],
      note: typeof catalog?.note === "string" ? catalog.note : "",
    };
  } catch (error) {
    if (picker?.name === name) picker.error = error.message;
  }
  renderPicker();
  $("picker-search").focus();
}

function closePicker() {
  picker = null;
  if ($("picker").open) $("picker").close();
}

function pickerRow(item, type, kept) {
  const row = document.createElement("label");
  row.className = "picker-row";
  const input = document.createElement("input");
  input.type = type;
  input.name = type === "radio" ? "picker-sound" : "";
  input.value = item.id;
  input.checked = type === "radio" ? picker.sound === item.id : picker.ticked.has(item.id);
  input.onchange = () => {
    if (type === "radio") picker.sound = input.value;
    else if (input.checked) picker.ticked.add(item.id);
    else picker.ticked.delete(item.id);
    renderPickerCount();
  };
  const text = document.createElement("span");
  text.className = "picker-text";
  text.append(Object.assign(document.createElement("span"), { className: "name", textContent: String(item.label || item.id) }));
  if (item.meta) text.append(Object.assign(document.createElement("small"), { textContent: String(item.meta) }));
  row.append(input, text);
  if (item.favourite) row.append(Object.assign(document.createElement("span"), { className: "star", textContent: "\u2605", title: "A favourite" }));
  if (kept) row.append(Object.assign(document.createElement("span"), { className: "used", textContent: "In song" }));
  return row;
}

function renderPicker() {
  const body = $("picker-body");
  $("picker-favourites").setAttribute("aria-pressed", String(Boolean(picker?.favourites)));
  if (!picker) return;
  if (picker.error || !picker.catalog) {
    const text = picker.error || `Asking ${picker.name} what it has...`;
    body.replaceChildren(Object.assign(document.createElement("p"), { className: picker.error ? "muted error-text" : "muted", textContent: text }));
    renderPickerCount();
    return;
  }
  const words = picker.search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (items) => items.filter((item) => (!picker.favourites || item.favourite)
    && words.every((word) => `${item.label} ${item.meta || ""}`.toLowerCase().includes(word)));
  const keptIds = new Set((song.assets[picker.name]?.patterns || []).map((item) => item.id));
  const parts = [];
  const group = (title, items, type, empty) => {
    const list = shown(items);
    const box = Object.assign(document.createElement("section"), { className: "picker-group" });
    box.append(Object.assign(document.createElement("h3"), { textContent: title }));
    if (type === "radio") box.append(pickerRow({ id: "", label: song.assets[picker.name]?.sound ? `Keep "${song.assets[picker.name].sound.label}"` : "No sound", meta: "Leaves the song's sound as it is" }, "radio", false));
    for (const item of list.slice(0, PICKER_SHOWN)) box.append(pickerRow(item, type, type !== "radio" && keptIds.has(item.id)));
    if (list.length > PICKER_SHOWN) box.append(Object.assign(document.createElement("p"), { className: "muted", textContent: `Showing ${PICKER_SHOWN} of ${list.length}. Search to find the others.` }));
    if (!list.length) box.append(Object.assign(document.createElement("p"), { className: "muted", textContent: items.length ? "None match." : empty }));
    parts.push(box);
  };
  const { catalog } = picker;
  const instrument = Song.INSTRUMENTS.find((item) => item.name === picker.name);
  const word = instrument?.word ? "sequences" : "patterns";
  group(instrument?.library ? "In the grid now" : `In the grid now, by ${instrument?.word ? "sequence" : "pattern"} number`, catalog.grid, "checkbox", `No ${word} with notes in it.`);
  if (catalog.patterns.length || !instrument?.word) group(instrument?.library ? "In its library" : "Saved in its library", catalog.patterns, "checkbox", catalog.note ? "Its library isn't open." : "No saved patterns.");
  if (catalog.sounds.length || !(instrument?.library || instrument?.word)) group("Sound for this song", catalog.sounds, "radio", catalog.note ? "Its library isn't open." : "No sounds to pick from.");
  if (catalog.note) parts.push(Object.assign(document.createElement("p"), { className: "muted", textContent: catalog.note }));
  body.replaceChildren(...parts);
  renderPickerCount();
}

function renderPickerCount() {
  const count = picker ? picker.ticked.size : 0;
  const sound = Boolean(picker?.sound);
  $("picker-count").textContent = !picker?.catalog ? "" : count || sound
    ? `${count ? `${count} pattern${count === 1 ? "" : "s"}` : ""}${count && sound ? " and " : ""}${sound ? "a sound" : ""} picked`
    : "Tick what this song needs.";
  $("picker-add").disabled = !picker?.catalog || picker.busy || (!count && !sound);
}

// Copies what's ticked from the grid into the song's assets.
async function addPicked() {
  if (!picker?.catalog || picker.busy) return;
  const { name } = picker;
  picker.busy = true;
  renderPickerCount();
  let got;
  try {
    got = await link.ask(name, "fetch", { patterns: [...picker.ticked], sound: picker.sound || null }, 10000);
  } catch (error) {
    if (picker?.name === name) {
      picker.busy = false;
      $("picker-count").textContent = error.message;
      renderPickerCount();
      setStatus(error.message, true);
    }
    return;
  }
  // Closing the picker while it waited cancels the add.
  if (picker?.name !== name) return;
  const patterns = Array.isArray(got?.patterns) ? got.patterns : [];
  const sound = got?.sound && typeof got.sound.label === "string" ? got.sound : null;
  let result = { added: 0, full: 0 };
  change(() => { result = Song.addAssets(song, name, { patterns, sound }); });
  closePicker();
  const parts = [];
  if (result.added) parts.push(`${result.added} pattern${result.added === 1 ? "" : "s"}`);
  if (sound) parts.push(`the sound "${sound.label}"`);
  const full = result.full ? ` ${result.full} didn't fit, as every pattern number holds one. Remove some first.` : "";
  setStatus(parts.length ? `Added ${parts.join(" and ")} from ${labelOf(name)}. Load puts ${result.added + (sound ? 1 : 0) === 1 ? "it" : "them"} into the grid.${full}` : `Nothing was added from ${labelOf(name)}.${full}`, Boolean(result.full) || !parts.length);
}

function moveAssetTo(name, id, ref) {
  change(() => Song.moveAsset(song, name, id, ref));
}

function removeAsset(name, id) {
  change(() => {
    const kept = song.assets[name];
    if (id === "sound") kept.sound = null;
    else kept.patterns = kept.patterns.filter((item) => item.id !== id);
  });
}

function renderAssets() {
  const busy = Boolean(collecting || loading);
  $("collect-all").disabled = busy;
  $("load-all").disabled = busy || !Song.INSTRUMENTS.some(({ name }) => peers.includes(name) && hasAssets(name));
  $("asset-list").replaceChildren(...Song.INSTRUMENTS.map((instrument) => {
    const group = Object.assign(document.createElement("div"), { className: "asset-group" });
    const kept = song.assets[instrument.name];
    const head = Object.assign(document.createElement("div"), { className: "asset-head" });
    const note = document.createElement("small");
    const waiting = loading && [...loading.requests.values()].includes(instrument.name) && !loading.results.has(instrument.name);
    if (collecting?.asked.has(instrument.name) && !collecting.answered.has(instrument.name)) note.textContent = "Collecting...";
    else if (waiting) note.textContent = "Putting back...";
    else if (kept) note.textContent = `Collected ${shortDate(kept.collected)}: ${kept.patterns.length} pattern${kept.patterns.length === 1 ? "" : "s"}${kept.sound ? ", sound" : ""}`;
    else note.textContent = "Nothing kept yet";
    const open = peers.includes(instrument.name);
    const button = toolButton("Add", open ? `Pick patterns${instrument.library || instrument.word ? "" : " and a sound"} from ${instrument.name} and its library to keep with this song` : `Open ${instrument.name}, with Sync ticked, to pick from it`,
      () => openPicker(instrument.name), !open || busy);
    const load = toolButton("Load", !hasAssets(instrument.name) ? "Nothing is kept from this grid yet"
      : open ? `Put this song's ${instrument.label} patterns${kept.sound ? " and sound" : ""} back into ${instrument.name}` : `Open ${instrument.name}, with Sync ticked, to put them back into it`,
    () => loadInto([instrument.name]), !open || !hasAssets(instrument.name) || busy);
    head.append(Object.assign(document.createElement("strong"), { textContent: instrument.label }), note, button, load);
    group.append(head);
    if (kept) {
      const list = Object.assign(document.createElement("ul"), { className: "asset-items" });
      const loadable = open && !busy;
      for (const item of kept.patterns) {
        const row = document.createElement("li");
        const text = Object.assign(document.createElement("span"), { className: "asset-text" });
        text.append(Object.assign(document.createElement("span"), { className: "name", textContent: item.label, title: item.label }),
          Object.assign(document.createElement("span"), { className: "meta", textContent: `${item.length}${item.length ? ", " : ""}${item.notes} note${item.notes === 1 ? "" : "s"}` }));
        row.append(text);
        if (Song.usesPattern(song, instrument.name, item.ref)) row.append(Object.assign(document.createElement("span"), { className: "used", textContent: "Used" }));
        if (!instrument.library && !instrument.word) {
          // Which pattern number it goes in, in the grid and in the arrangement.
          const slot = document.createElement("select");
          slot.className = "slot-select";
          slot.append(...Array.from({ length: Song.PATTERNS }, (_, index) => new Option(`Pattern ${index + 1}`, String(index))));
          slot.value = String(item.ref);
          slot.title = "The pattern number it goes in when it's loaded. Choosing one used by another swaps them.";
          slot.setAttribute("aria-label", `Pattern number for ${item.label}`);
          slot.onchange = () => moveAssetTo(instrument.name, item.id, Number(slot.value));
          row.append(slot);
        }
        const send = toolButton("\u2191", loadable ? `Put ${item.label} into ${instrument.name} now` : `Open ${instrument.name}, with Sync ticked, to load it`,
          () => loadInto([instrument.name], { patterns: [item], sound: null }), !loadable);
        send.className = "load-one";
        send.setAttribute("aria-label", `Load ${item.label}`);
        row.append(send);
        const remove = toolButton("\u00d7", `Remove ${item.label} from this song's assets`, () => removeAsset(instrument.name, item.id));
        remove.setAttribute("aria-label", `Remove ${item.label}`);
        row.append(remove);
        list.append(row);
      }
      if (kept.sound) {
        const row = Object.assign(document.createElement("li"), { className: "sound" });
        row.append(Object.assign(document.createElement("span"), { className: "name", textContent: kept.sound.label, title: kept.sound.label }));
        const send = toolButton("\u2191", loadable ? `Send this sound to ${instrument.name} now` : `Open ${instrument.name}, with Sync ticked, to send it`,
          () => loadInto([instrument.name], { patterns: [], sound: kept.sound }), !loadable);
        send.className = "load-one";
        send.setAttribute("aria-label", `Load ${instrument.label} sound`);
        row.append(send);
        const remove = toolButton("\u00d7", "Remove the sound from this song's assets", () => removeAsset(instrument.name, "sound"));
        remove.setAttribute("aria-label", `Remove ${instrument.label} sound`);
        row.append(remove);
        list.append(row);
      }
      if (!kept.patterns.length && !kept.sound) list.append(Object.assign(document.createElement("li"), { className: "meta", textContent: "No patterns or sound." }));
      group.append(list);
    }
    return group;
  }));
}

/* ---------- Saved songs ---------- */

function renderSongs() {
  $("songs-empty").hidden = songs.length > 0;
  $("song-list").replaceChildren(...songs.map((item) => {
    const row = document.createElement("li");
    row.classList.toggle("current", item.id === songId);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "open";
    open.textContent = item.song.name || "Untitled";
    const about = document.createElement("small");
    about.textContent = `${Song.totalBars(item.song)} bars`;
    open.append(about);
    open.title = `Open "${item.song.name || "Untitled"}". Saved ${item.saved.slice(0, 10)}.`;
    open.onclick = () => openSong(item);
    const remove = toolButton("Delete", "Delete this saved song", () => {
      if (!window.confirm(`Delete "${item.song.name || "Untitled"}"? This can't be undone, unless it's in a backup.`)) return;
      songs = songs.filter((other) => other !== item);
      if (songId === item.id) songId = null;
      writeJson(SONGS_KEY, songs);
      save();
      renderSongs();
    });
    row.append(open, remove);
    return row;
  }));
}

function openSong(item) {
  if (playback.on) togglePlay();
  song = Song.cleanSong(JSON.parse(JSON.stringify(item.song)));
  songId = item.id;
  save();
  render();
  setStatus(`Opened "${song.name || "Untitled"}".`);
}

function saveSong(asNew) {
  if (!song.name) {
    const name = window.prompt("Name this song", "")?.trim();
    if (!name) return;
    song.name = name.slice(0, 40);
  }
  const existing = !asNew && songs.find((item) => item.id === songId);
  const copy = JSON.parse(JSON.stringify(song));
  if (existing) {
    Object.assign(existing, { song: copy, saved: new Date().toISOString() });
  } else {
    const item = { id: newId(), song: copy, saved: new Date().toISOString() };
    songs.unshift(item);
    songId = item.id;
  }
  writeJson(SONGS_KEY, songs);
  save();
  render();
  setStatus(`Saved "${song.name}".`);
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importSongs(file) {
  let added = [];
  try {
    const data = JSON.parse(await file.text());
    added = cleanSongs(data.songs).map((item) => ({ ...item, id: songs.some((other) => other.id === item.id) ? newId() : item.id }));
  } catch {
    added = [];
  }
  if (!added.length) {
    setStatus(`${file.name} has no songs in it.`, true);
    return;
  }
  songs.push(...added);
  writeJson(SONGS_KEY, songs);
  renderSongs();
  setStatus(`Added ${added.length} song${added.length === 1 ? "" : "s"} from ${file.name}.`);
}

/* ---------- Setting up ---------- */

function setTheme(light) {
  if (light) document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  $("theme-toggle").textContent = light ? "Dark mode" : "Light mode";
  try {
    localStorage.setItem(THEME_KEY, light ? "light" : "dark");
  } catch {
    // It's just not remembered.
  }
}

function bind() {
  window.addEventListener("storage", (event) => { if (event.key === "td3-grid-library") render(); });
  $("play").onclick = togglePlay;
  $("song-name").onchange = () => change(() => { song.name = $("song-name").value.trim().slice(0, 40); });
  $("bpm").onchange = () => {
    const bpm = Number($("bpm").value);
    if (!(bpm >= 20 && bpm <= 300)) {
      $("bpm").value = String(playback.on ? playback.bpm : song.bpm);
      return;
    }
    song.bpm = Math.round(bpm * 10) / 10;
    save();
    if (playback.on) {
      // Tells the grids where the song is now, so they keep their place at the new speed.
      const nextTime = performance.now() + 60;
      retime(song.bpm, nextTime);
      link.announceTempo({ bpm: song.bpm, nextTime, nextPulse: Math.round(playback.anchorPulse) });
    }
  };
  $("loop").onchange = () => change(() => { song.loop = $("loop").checked; });
  $("section-back").onclick = () => skipSection(-1);
  $("section-next").onclick = () => skipSection(1);
  $("add-section").onclick = () => copySection(song.sections.length - 1);
  $("collect-all").onclick = () => collect(Song.INSTRUMENTS.map((item) => item.name));
  $("load-all").onclick = () => loadInto(Song.INSTRUMENTS.map((item) => item.name));
  $("picker-close").onclick = closePicker;
  $("picker-cancel").onclick = closePicker;
  $("picker").addEventListener("close", () => { picker = null; });
  $("picker-add").onclick = addPicked;
  $("picker-search").oninput = () => { if (picker) { picker.search = $("picker-search").value; renderPicker(); } };
  $("picker-favourites").onclick = () => { if (picker) { picker.favourites = !picker.favourites; renderPicker(); } };
  $("save").onclick = () => saveSong(false);
  $("save-new").onclick = () => saveSong(true);
  $("new-song").onclick = () => {
    if (!window.confirm("Start a new song? Unsaved changes to this one are lost.")) return;
    if (playback.on) togglePlay();
    song = Song.newSong();
    songId = null;
    save();
    render();
  };
  $("export").onclick = () => {
    download(`songs-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "song-grid", version: 1, songs }, null, 1));
    setStatus(`Downloaded a backup of ${songs.length} song${songs.length === 1 ? "" : "s"}.`);
  };
  $("import").onclick = () => $("import-file").click();
  $("import-file").onchange = () => {
    const [file] = $("import-file").files;
    $("import-file").value = "";
    if (file) importSongs(file);
  };
  $("theme-toggle").onclick = () => setTheme(document.documentElement.dataset.theme !== "light");
  $("help-open").onclick = () => $("help").showModal();
  $("help-close").onclick = () => $("help").close();
  document.addEventListener("keydown", (event) => {
    if (event.target.closest("input, select, textarea") || document.querySelector("dialog[open]")) return;
    if (event.key === " ") {
      event.preventDefault();
      togglePlay();
    } else if (event.key === "?") {
      $("help").showModal();
    }
  });
  window.addEventListener("pagehide", () => { if (playback.on) link.announceStop(); });
}

restore();
setTheme(document.documentElement.dataset.theme === "light");
bind();
render();
setStatus("Open the grids in this browser with Sync ticked, choose a pattern for each section, then press Play.");
