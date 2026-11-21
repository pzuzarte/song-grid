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
const playback = { on: false, anchorTime: 0, anchorPulse: 0, bpm: 120, timer: null };

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

function patternSelect(item, name) {
  const select = document.createElement("select");
  select.append(new Option("Off", ""), ...Array.from({ length: Song.PATTERNS }, (_, index) => new Option(`Pattern ${index + 1}`, String(index))));
  const value = item.patterns[name];
  select.value = value === null ? "" : String(value);
  select.classList.toggle("off", value === null);
  select.setAttribute("aria-label", `${name} in ${item.name}`);
  select.onchange = () => change(() => {
    item.patterns[name] = select.value === "" ? null : Number(select.value);
  });
  return select;
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
  rows.push(tools, names, bars);

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
      cell.append(patternSelect(item, instrument.name));
      row.append(cell);
    });
    rows.push(row);
  }
  table.replaceChildren(...rows);
  renderPlaying();
  renderSongs();
}

/* ---------- Playing ---------- */

const msPerPulse = () => 60000 / (playback.bpm * PPQ);
const pulseAt = (time) => playback.anchorPulse + (time - playback.anchorTime) / msPerPulse();

function renderPlaying() {
  $("play").textContent = playback.on ? "Stop" : "Play";
  $("play").setAttribute("aria-pressed", String(playback.on));
  const total = Song.totalBars(song);
  let current = null;
  let text = "";
  if (playback.on) {
    let bar = Math.max(0, Math.floor(pulseAt(performance.now()) / BAR_PULSES));
    if (song.loop) bar %= total;
    const at = Song.sectionAt(song, Math.min(bar, total - 1));
    current = at ? at.index : null;
    if (at) text = `Bar ${Math.min(bar, total - 1) + 1} of ${total}: ${song.sections[at.index].name}, bar ${at.bar + 1}`;
  }
  $("position").textContent = text;
  document.querySelectorAll("#table td").forEach((cell) => {
    cell.classList.toggle("playing", current !== null && Number(cell.dataset.section) === current);
  });
}

function tick() {
  if (!playback.on) return;
  const bar = Math.floor(pulseAt(performance.now()) / BAR_PULSES);
  // The grids stop themselves at the end, so this page only catches up.
  if (!song.loop && bar >= Song.totalBars(song)) {
    stopPlaying();
    setStatus("The song has ended.");
    return;
  }
  renderPlaying();
}

function startPlaying() {
  if (!peers.some((name) => Song.INSTRUMENTS.some((item) => item.name === name))) {
    setStatus("Open S-1 Grid, Protein Grid or Bass Station Grid in this browser, with Sync ticked, to play the song.", true);
    return;
  }
  link.announceSong(Song.plan(song));
  const at = link.announcePlay(song.bpm);
  if (at === null) {
    setStatus("Couldn't reach the grids. Reload this page and try again.", true);
    return;
  }
  Object.assign(playback, { on: true, anchorTime: at, anchorPulse: 0, bpm: song.bpm });
  clearInterval(playback.timer);
  playback.timer = setInterval(tick, 100);
  renderPlaying();
  const playing = Song.INSTRUMENTS.filter((item) => peers.includes(item.name)).map((item) => item.label);
  setStatus(`Playing "${song.name || "Untitled"}" on ${playing.join(", ")}.`);
}

function stopPlaying() {
  playback.on = false;
  clearInterval(playback.timer);
  $("bpm").value = String(song.bpm);
  renderPlaying();
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
});
syncBox.checked = true;

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
  $("add-section").onclick = () => copySection(song.sections.length - 1);
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
