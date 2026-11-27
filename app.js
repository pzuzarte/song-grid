"use strict";
/* Song Grid: arranges the grids' patterns into sections and plays them as a song. It makes
   no sound itself. Through sync.js it sends each open grid its part of the song, then
   starts them together, and shows where the song has got to. The song model is in song.js. */

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "song-grid";
const SONGS_KEY = "song-grid-songs";
// Shared by all the grids, so switching one switches them all.
const THEME_KEY = "midi-grids-theme";
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
const PREFS_KEY = "song-grid-prefs";
const SETLIST_KEY = "song-grid-setlist";
// The grids muted, and soloed, with the buttons beside each. Kept while the page is open.
const mix = { muted: new Set(), solo: new Set() };
// Choices kept in this browser: a count-in, and showing each section's extra settings.
const prefs = { countIn: false, more: false, tab: "parts", zoom: 24 };
// The block picked in the arranger, by id.
let selected = null;
// Recording a take: whether it's on, and the sections played since it started, in order.
const take = { on: false, sections: [] };
// The set list, as saved song ids, and while one plays, which song it's on.
let setList = [];
let setPlaying = null;

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
  const kept = readJson(PREFS_KEY, {});
  prefs.countIn = Boolean(kept.countIn);
  prefs.more = Boolean(kept.more);
  prefs.tab = kept.tab === "arranger" ? "arranger" : "parts";
  prefs.zoom = ZOOMS.includes(kept.zoom) ? kept.zoom : 24;
  const list = readJson(SETLIST_KEY, []);
  setList = Array.isArray(list) ? list.filter((id) => typeof id === "string") : [];
}

const savePrefs = () => writeJson(PREFS_KEY, prefs);

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

// The patterns kept in the song's assets for a grid, as menu choices: their names, by the
// pattern number each goes in. A number the arrangement uses with nothing kept for it
// shows as such, so older songs still show what they play.
function assetOptions(instrument, value, prefix = "") {
  const kept = song.assets[instrument.name]?.patterns || [];
  const options = kept.map((entry) => new Option(`${prefix}${entry.label}`, String(entry.ref)));
  if (Number.isInteger(value) && !kept.some((entry) => entry.ref === value)) {
    options.push(new Option(`${prefix}${instrument.word || "Pattern"} ${value + 1} (not in Assets)`, String(value)));
  }
  if (!kept.length) {
    const hint = new Option(`Add ${instrument.label} patterns in Assets`, "hint");
    hint.disabled = true;
    options.push(hint);
  }
  return options;
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
    select.append(new Option("Off", ""), ...assetOptions(instrument, value));
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

// The pattern a grid plays in a section's last bar: none, silence, or a pattern.
function fillSelect(item, instrument) {
  const { name } = instrument;
  const select = document.createElement("select");
  select.className = "fill-select";
  select.append(new Option("No fill", "none"), new Option("Fill: Off", "off"));
  if (instrument.library) {
    select.append(new Option("Fill: Grid pattern", Song.GRID), ...td3Library().map((entry) => new Option(`Fill: ${entry.name}`, entry.id)));
  } else {
    select.append(...assetOptions(instrument, item.fills[name], "Fill: ").filter((option) => option.value !== "hint"));
  }
  const value = item.fills[name];
  select.value = !(name in item.fills) ? "none" : value === null ? "off" : String(value);
  if (select.value === "" && value) {
    select.append(new Option("Fill: (not in the library)", value));
    select.value = value;
  }
  select.disabled = item.bars < 2;
  select.title = item.bars < 2 ? "A fill plays in the section's last bar, so the section needs two bars or more" : "What this grid plays in the section's last bar, in place of its pattern";
  select.setAttribute("aria-label", `${name} fill in ${item.name}`);
  select.onchange = () => change(() => {
    if (select.value === "none") delete item.fills[name];
    else if (select.value === "off") item.fills[name] = null;
    else item.fills[name] = instrument.library ? select.value : Number(select.value);
  });
  return select;
}

// The preset a grid is sent as the section starts, by program change, numbered from 1.
function presetInput(item, instrument) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = "128";
  input.className = "preset-input";
  input.placeholder = "Preset";
  const value = item.programs[instrument.name];
  input.value = Number.isInteger(value) ? String(value + 1) : "";
  input.title = "Sends a program change to pick this preset as the section starts. Leave it empty to keep the sound as it is.";
  input.setAttribute("aria-label", `${instrument.name} preset in ${item.name}`);
  input.onchange = () => change(() => {
    const number = Number(input.value);
    if (input.value === "" || !Number.isInteger(number) || number < 1 || number > 128) delete item.programs[instrument.name];
    else item.programs[instrument.name] = number - 1;
  });
  return input;
}

const usesExtras = (target) => target.sections.some((item) => item.bpm !== null || item.transpose
  || Object.keys(item.fills).length || Object.keys(item.programs).length);

// The grids muted as things stand: with any soloed, every grid but those.
const effectiveMutes = () => (mix.solo.size
  ? Song.INSTRUMENTS.map((item) => item.name).filter((name) => !mix.solo.has(name))
  : [...mix.muted]);

function toggleMix(kind, name) {
  const list = mix[kind];
  if (list.has(name)) list.delete(name);
  else list.add(name);
  if (playback.on) {
    sendMove({ atBar: nextSafeBar(), mutes: effectiveMutes() });
    setStatus("The mix changes on the next bar.");
  }
  render();
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

// Adds a copy of a part after it, in its own colour, and puts it at the end of the arranger.
function copySection(index) {
  if (song.sections.length >= Song.MAX_SECTIONS) {
    setStatus(`A song can have up to ${Song.MAX_SECTIONS} parts.`, true);
    return;
  }
  let copy = null;
  change((target) => {
    copy = Song.section({ ...JSON.parse(JSON.stringify(target.sections[index])), id: undefined, colour: Song.freeColour(target.sections) });
    target.sections.splice(index + 1, 0, copy);
    if (target.order.length < Song.MAX_BLOCKS) target.order.push(Song.block(copy.id));
  });
  setStatus(`Added "${copy.name}", and put it at the end of the arranger.`);
}

// Deletes a part, and its blocks in the arranger.
function deleteSection(index) {
  if (song.sections.length === 1) {
    setStatus("A song needs at least one part.", true);
    return;
  }
  const { name, id } = song.sections[index];
  const count = song.order.filter((item) => item.part === id).length;
  if (count > 1 && !window.confirm(`Delete "${name}"? It's in the arranger ${count} times, and those blocks go too.`)) return;
  change((target) => {
    target.sections.splice(index, 1);
    target.order = target.order.filter((item) => item.part !== id);
  });
  setStatus(`Deleted "${name}"${count ? `, and its block${count === 1 ? "" : "s"} in the arranger` : ""}.`);
}

// Gives a part the next colour.
function cycleColour(index) {
  change((target) => {
    const item = target.sections[index];
    item.colour = ((item.colour ?? -1) + 1) % Song.COLOURS;
  });
}

function render() {
  $("song-name").value = song.name;
  $("bpm").value = String(playback.on ? playback.bpm : song.bpm);
  $("loop").checked = song.loop;
  $("total").textContent = prefs.tab === "parts"
    ? `${song.sections.length} part${song.sections.length === 1 ? "" : "s"}`
    : `${song.order.length} block${song.order.length === 1 ? "" : "s"}, ${Song.totalBars(song)} bars, ${clock(Song.seconds(song))}`;
  renderTabs();

  const table = $("table");
  const rows = [];
  const warned = Song.warnings(song, td3Library());
  const count = song.sections.length;

  const tools = document.createElement("tr");
  tools.append(document.createElement("th"));
  const names = document.createElement("tr");
  names.append(Object.assign(document.createElement("th"), { textContent: "Part" }));
  const bars = document.createElement("tr");
  bars.append(Object.assign(document.createElement("th"), { textContent: "Bars" }));
  song.sections.forEach((item, index) => {
    const cell = document.createElement("td");
    cell.className = "section-tools";
    cell.dataset.section = String(index);
    cell.append(
      toolButton("<", "Move this part left. The order here is only for editing: the Arranger sets the order they play.", () => moveSection(index, -1), index === 0),
      toolButton(">", "Move this part right. The order here is only for editing: the Arranger sets the order they play.", () => moveSection(index, 1), index === count - 1),
      toolButton("Copy", "Add a copy of this part after it, and at the end of the arranger", () => copySection(index)),
      toolButton("Del", "Delete this part, and its blocks in the arranger", () => deleteSection(index)),
    );

    tools.append(cell);

    const nameCell = document.createElement("td");
    nameCell.dataset.section = String(index);
    const name = document.createElement("input");
    name.type = "text";
    name.maxLength = 30;
    name.value = item.name;
    name.setAttribute("aria-label", `Part ${index + 1} name`);
    name.onchange = () => change(() => { item.name = name.value.trim() || `Part ${index + 1}`; });
    const used = song.order.filter((entry) => entry.part === item.id).length;
    const swatch = toolButton("", `${item.name}'s colour in the arranger. Click for the next one.`, () => cycleColour(index));
    swatch.className = "swatch";
    swatch.style.setProperty("--part", partColour(item));
    swatch.setAttribute("aria-label", `Change ${item.name}'s colour`);
    const inner = Object.assign(document.createElement("div"), { className: "name-cell" });
    inner.append(swatch, name);
    nameCell.append(inner);
    nameCell.title = used ? `In the arranger ${used} time${used === 1 ? "" : "s"}` : "Not in the arranger yet";
    nameCell.classList.toggle("unused", !used);
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
    cell.dataset.part = item.id;
    const queued = playback.queued?.part === item.id;
    const loop = iconButton("loop", `Loop ${item.name}`,
      item.loop ? "Looping: this part repeats each time it's reached. Click to stop it looping." : "Loop: repeat this part each time it's reached, until you click again",
      item.loop, () => toggleLoop(index));
    const next = iconButton("next", `Play ${item.name} next`,
      queued ? "Up next: plays when the block playing finishes. Click to cancel." : "Up next: play this part when the block playing finishes, from its next block in the arranger",
      queued, () => queuePart(index));
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

  // Each section's own tempo and transpose, shown with its fills and presets.
  const more = prefs.more || usesExtras(song);
  $("more-toggle").setAttribute("aria-pressed", String(more));
  // While a section uses them they stay shown.
  $("more-toggle").disabled = usesExtras(song);
  if (more) {
    const tempo = document.createElement("tr");
    tempo.append(Object.assign(document.createElement("th"), { textContent: "Tempo" }));
    const shift = document.createElement("tr");
    shift.append(Object.assign(document.createElement("th"), { textContent: "Transpose" }));
    song.sections.forEach((item, index) => {
      const cell = document.createElement("td");
      cell.dataset.section = String(index);
      const input = document.createElement("input");
      input.type = "number";
      input.min = "20";
      input.max = "300";
      input.step = "0.1";
      input.placeholder = String(song.bpm);
      input.value = item.bpm === null ? "" : String(item.bpm);
      input.title = "This section's tempo. Leave it empty to play at the song's BPM.";
      input.setAttribute("aria-label", `${item.name} tempo`);
      input.onchange = () => change(() => {
        const bpm = Number(input.value);
        item.bpm = input.value === "" || !(bpm >= 20 && bpm <= 300) ? null : Math.round(bpm * 10) / 10;
      });
      cell.append(input);
      tempo.append(cell);
      const shiftCell = document.createElement("td");
      shiftCell.dataset.section = String(index);
      const select = document.createElement("select");
      for (let value = -12; value <= 12; value += 1) select.append(new Option(value === 0 ? "None" : `${value > 0 ? "+" : ""}${value} st`, String(value)));
      select.value = String(item.transpose);
      select.title = "Shifts the notes of every grid but MPC Grid in this section, by semitones (st)";
      select.setAttribute("aria-label", `${item.name} transpose`);
      select.onchange = () => change(() => { item.transpose = Number(select.value); });
      shiftCell.append(select);
      shift.append(shiftCell);
    });
    rows.push(tempo, shift);
  }

  for (const instrument of Song.INSTRUMENTS) {
    const row = document.createElement("tr");
    const open = peers.includes(instrument.name);
    row.classList.toggle("closed", !open);
    row.classList.toggle("silenced", effectiveMutes().includes(instrument.name));
    const label = document.createElement("th");
    label.className = "instrument";
    const mute = toolButton("M", mix.muted.has(instrument.name) ? `Unmute ${instrument.name}` : `Mute ${instrument.name}`, () => toggleMix("muted", instrument.name));
    mute.className = "mix-button";
    mute.setAttribute("aria-pressed", String(mix.muted.has(instrument.name)));
    const solo = toolButton("S", mix.solo.has(instrument.name) ? `Stop soloing ${instrument.name}` : `Solo ${instrument.name}: mute every other grid`, () => toggleMix("solo", instrument.name));
    solo.className = "mix-button solo";
    solo.setAttribute("aria-pressed", String(mix.solo.has(instrument.name)));
    const top = Object.assign(document.createElement("span"), { className: "instrument-top" });
    top.append(Object.assign(document.createElement("span"), { textContent: instrument.label }), mute, solo);
    label.append(top);
    const note = document.createElement("small");
    if (open) {
      note.textContent = "Linked";
    } else {
      const link = document.createElement("a");
      link.href = instrument.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Not linked";
      link.title = `Open ${instrument.name}, or go to it if it's open, and tick Sync at its top`;
      note.append(link);
    }
    label.append(note);
    row.append(label);
    const flagged = new Set(warned.filter((entry) => entry.name === instrument.name).map((entry) => entry.section));
    song.sections.forEach((item, index) => {
      const cell = document.createElement("td");
      cell.dataset.section = String(index);
      cell.classList.toggle("warn", flagged.has(index));
      cell.append(patternSelect(item, instrument));
      row.append(cell);
    });
    rows.push(row);
    if (more) {
      // Its fill, and preset where it has them, under its pattern.
      const extra = document.createElement("tr");
      extra.className = "extra-row";
      extra.classList.toggle("closed", !open);
      extra.append(Object.assign(document.createElement("th"), { textContent: instrument.presets ? "Fill, preset" : "Fill" }));
      song.sections.forEach((item, index) => {
        const cell = document.createElement("td");
        cell.dataset.section = String(index);
        const inner = Object.assign(document.createElement("div"), { className: "extra-cell" });
        inner.append(fillSelect(item, instrument));
        if (instrument.presets) inner.append(presetInput(item, instrument));
        cell.append(inner);
        extra.append(cell);
      });
      rows.push(extra);
    }
  }
  table.replaceChildren(...rows);
  $("warnings").replaceChildren(...warned.map((entry) => Object.assign(document.createElement("li"), { textContent: entry.text })));
  $("warnings").hidden = !warned.length;
  renderArranger();
  renderPlaying();
  renderAssets();
  renderSongs();
}

/* ---------- Tabs ---------- */

function showTab(tab) {
  prefs.tab = tab;
  savePrefs();
  render();
  if (tab === "arranger") requestAnimationFrame(() => scrollToPlaying());
}

function renderTabs() {
  const arranger = prefs.tab === "arranger";
  $("tab-parts").setAttribute("aria-selected", String(!arranger));
  $("tab-arranger").setAttribute("aria-selected", String(arranger));
  $("view-parts").hidden = arranger;
  $("view-arranger").hidden = !arranger;
  document.querySelectorAll(".parts-only").forEach((item) => { item.hidden = arranger; });
}

/* ---------- Arranger ---------- */

// Each part's colour, by its colour number. Dark text reads on all of them.
const PART_COLOURS = ["#e5675d", "#ec9a3f", "#d9c143", "#74bf5b", "#3db6a4", "#4fa0e2", "#8284ea", "#b673e0", "#e273b0", "#a8957f"];
const partColour = (item) => PART_COLOURS[(item?.colour ?? 0) % PART_COLOURS.length];
// Pixels a bar is wide, at each zoom.
const ZOOMS = [4, 6, 10, 16, 24, 36, 56, 80, 120];
const partById = (id) => song.sections.find((item) => item.id === id);

// Minutes and seconds.
function clock(seconds) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// When each bar of the arrangement starts, in seconds, with each part's tempo.
function barTimes() {
  const times = [0];
  for (const item of Song.expand(song).sections) {
    const each = (4 * 60) / (item.bpm ?? song.bpm);
    for (let bar = 0; bar < item.bars; bar += 1) times.push(times[times.length - 1] + each);
  }
  return times;
}

function setZoom(zoom, anchor = null) {
  const scroll = $("arranger-scroll");
  // Keeps the bar in the middle, or under the pointer, where it is.
  const x = anchor ?? scroll.clientWidth / 2;
  const bar = (scroll.scrollLeft + x - 8) / prefs.zoom;
  prefs.zoom = zoom;
  savePrefs();
  renderArranger();
  scroll.scrollLeft = bar * zoom + 8 - x;
}

function zoomBy(steps, anchor) {
  const index = ZOOMS.indexOf(prefs.zoom);
  const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, index + steps))];
  if (next !== prefs.zoom) setZoom(next, anchor);
}

// The largest zoom that shows the whole song.
function zoomToFit() {
  const width = $("arranger-scroll").clientWidth - 24;
  const bars = Math.max(1, Song.totalBars(song));
  setZoom([...ZOOMS].reverse().find((zoom) => zoom * bars <= width) || ZOOMS[0]);
  $("arranger-scroll").scrollLeft = 0;
}

function renderArranger() {
  const zoom = prefs.zoom;
  const played = Song.expand(song).sections;
  const bars = Song.totalBars(song);
  const times = barTimes();
  // Room after the last block to drop one at the end.
  const width = Math.max(bars + 8, 16) * zoom + 16;
  $("arranger").style.width = `${width}px`;
  $("zoom-out").disabled = prefs.zoom === ZOOMS[0];
  $("zoom-in").disabled = prefs.zoom === ZOOMS[ZOOMS.length - 1];

  // The parts, to add.
  $("part-chips").replaceChildren(...song.sections.map((item) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.style.setProperty("--part", partColour(item));
    chip.dataset.part = item.id;
    chip.title = `${item.name}, ${item.bars} bar${item.bars === 1 ? "" : "s"}. Click to add it at the end, or drag it to where it should go.`;
    chip.append(Object.assign(document.createElement("span"), { textContent: item.name }), Object.assign(document.createElement("small"), { textContent: String(item.bars) }));
    chip.onpointerdown = (event) => startDrag(event, { part: item.id, from: chip });
    return chip;
  }));

  // Bar numbers, every few bars as the zoom allows, with the time each starts.
  const every = [1, 2, 4, 8, 16, 32, 64].find((count) => count * zoom >= 44) || 64;
  const marks = [];
  for (let bar = 0; bar <= bars + 8; bar += 1) {
    if (bar % every && zoom < 10) continue;
    const mark = document.createElement("span");
    mark.className = bar % every ? "tick" : "tick major";
    mark.style.left = `${8 + bar * zoom}px`;
    if (!(bar % every)) {
      mark.append(Object.assign(document.createElement("b"), { textContent: String(bar + 1) }));
      if (bar <= bars) mark.append(Object.assign(document.createElement("small"), { textContent: clock(times[bar]) }));
    }
    marks.push(mark);
  }
  $("ruler").replaceChildren(...marks);

  // The blocks.
  let start = 0;
  $("lane").replaceChildren(...played.map((item, index) => {
    const block = document.createElement("div");
    block.className = "arr-block";
    block.tabIndex = 0;
    block.dataset.block = item.id;
    block.dataset.index = String(index);
    block.style.left = `${8 + start * zoom}px`;
    block.style.width = `${Math.max(3, item.bars * zoom - 2)}px`;
    block.style.setProperty("--part", partColour(item));
    block.classList.toggle("selected", item.id === selected);
    block.classList.toggle("looping", item.loop);
    block.classList.toggle("narrow", item.bars * zoom < 36);
    block.classList.toggle("queued", playback.on && playback.queued?.id === item.id);
    block.setAttribute("role", "button");
    block.setAttribute("aria-label", `${item.name}, ${item.bars} bars, from bar ${start + 1}`);
    block.title = `${item.name}: bars ${start + 1} to ${start + item.bars}${item.loop ? ", looping" : ""}. Drag to move it, Alt-drag to copy it, double-click to edit the part.`;
    block.append(Object.assign(document.createElement("span"), { className: "block-fill" }),
      Object.assign(document.createElement("span"), { className: "block-name", textContent: item.name }),
      Object.assign(document.createElement("small"), { textContent: `${item.bars}${item.loop ? " ∞" : ""}` }));
    block.onpointerdown = (event) => startDrag(event, { block: item.id, from: block });
    block.ondblclick = () => editPart(item.part);
    block.onfocus = () => { if (selected !== item.id) select(item.id); };
    start += item.bars;
    return block;
  }));
  if (!played.length) {
    $("lane").append(Object.assign(document.createElement("p"), { className: "lane-empty muted", textContent: "Nothing to play yet. Click a part above, or drag it here." }));
  }
  const picked = selected !== null && song.order.some((item) => item.id === selected);
  if (!picked) selected = null;
  $("block-copy").disabled = !picked;
  $("block-delete").disabled = !picked;
  $("block-next").disabled = !picked || !playback.on;
  renderUpcoming(true);
}

function select(id) {
  selected = id;
  document.querySelectorAll("#lane .arr-block").forEach((block) => block.classList.toggle("selected", block.dataset.block === id));
  $("block-copy").disabled = id === null;
  $("block-delete").disabled = id === null;
  $("block-next").disabled = id === null || !playback.on;
  renderUpcoming(true);
}

// Goes to a part's column in Parts.
function editPart(partId) {
  const index = song.sections.findIndex((item) => item.id === partId);
  if (index < 0) return;
  showTab("parts");
  const input = document.querySelector(`#table td[data-section="${index}"] input`);
  input?.scrollIntoView({ block: "nearest", inline: "center" });
  input?.focus();
}

function addBlock(partId, at = song.order.length) {
  if (song.order.length >= Song.MAX_BLOCKS) {
    setStatus(`The arranger holds up to ${Song.MAX_BLOCKS} blocks.`, true);
    return;
  }
  const item = Song.block(partId);
  change((target) => target.order.splice(at, 0, item));
  select(item.id);
  setStatus(`Added "${partById(partId)?.name}" at bar ${Song.bounds(song)[at].start + 1}.`);
}

function duplicateBlock(id = selected) {
  const index = song.order.findIndex((item) => item.id === id);
  if (index >= 0) addBlock(song.order[index].part, index + 1);
}

function deleteBlock(id = selected) {
  const index = song.order.findIndex((item) => item.id === id);
  if (index < 0) return;
  const name = partById(song.order[index].part)?.name;
  change((target) => target.order.splice(index, 1));
  const near = song.order[Math.min(index, song.order.length - 1)];
  select(near ? near.id : null);
  setStatus(`Removed a "${name}" block. The part is still in Parts.`);
}

// Moves or copies a block to a place in the arranger, counted in blocks.
function placeBlock(id, at, copy) {
  const from = song.order.findIndex((item) => item.id === id);
  if (from < 0) return;
  if (copy) {
    addBlock(song.order[from].part, at);
    return;
  }
  const to = at > from ? at - 1 : at;
  if (to === from) return;
  change((target) => {
    const [item] = target.order.splice(from, 1);
    target.order.splice(to, 0, item);
  });
  select(id);
}

/* Dragging, with the pointer: a block to move it (or copy it, with Alt), or a part from
   the row above to add it. While dragging, a line shows where it will go. A press that
   doesn't move is a click: it picks the block, or adds the part at the end. */
let drag = null;

function startDrag(event, source) {
  if (event.button !== 0) return;
  drag = { ...source, x: event.clientX, y: event.clientY, moved: false, at: null, ghost: null };
  source.from.setPointerCapture(event.pointerId);
  source.from.onpointermove = moveDrag;
  source.from.onpointerup = endDrag;
  source.from.onpointercancel = cancelDrag;
}

// Where a drop at a point would go, in blocks, and where its line goes, in pixels.
function dropAt(clientX) {
  const box = $("lane").getBoundingClientRect();
  const bar = (clientX - box.left - 8) / prefs.zoom;
  const ranges = Song.bounds(song);
  let at = ranges.findIndex((range) => bar < (range.start + range.end) / 2);
  if (at < 0) at = ranges.length;
  const x = 8 + (at < ranges.length ? ranges[at].start : Song.totalBars(song)) * prefs.zoom;
  return { at, x };
}

function moveDrag(event) {
  if (!drag) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
  if (!drag.moved) {
    drag.moved = true;
    drag.ghost = drag.from.cloneNode(true);
    drag.ghost.className = `${drag.from.className} drag-ghost`;
    drag.ghost.style.width = `${drag.from.offsetWidth}px`;
    document.body.append(drag.ghost);
    drag.from.classList.add("dragging");
  }
  drag.ghost.style.left = `${event.clientX + 6}px`;
  drag.ghost.style.top = `${event.clientY + 6}px`;
  const lane = $("arranger-scroll").getBoundingClientRect();
  const over = event.clientY >= lane.top - 30 && event.clientY <= lane.bottom + 30;
  // Scrolls along when dragged near an edge.
  if (over && event.clientX > lane.right - 30) $("arranger-scroll").scrollLeft += 12;
  if (over && event.clientX < lane.left + 30) $("arranger-scroll").scrollLeft -= 12;
  drag.at = over ? dropAt(event.clientX).at : null;
  $("drop-mark").hidden = !over;
  if (over) $("drop-mark").style.left = `${dropAt(event.clientX).x - 1}px`;
  drag.ghost.classList.toggle("copying", Boolean(drag.part || event.altKey));
  drag.copy = event.altKey;
}

function endDrag(event) {
  const was = drag;
  cancelDrag();
  if (!was) return;
  if (!was.moved) {
    if (was.part) addBlock(was.part);
    else select(was.block);
    return;
  }
  if (was.at === null) return;
  if (was.part) addBlock(was.part, was.at);
  else placeBlock(was.block, was.at, event.altKey || was.copy);
}

function cancelDrag() {
  if (!drag) return;
  drag.ghost?.remove();
  drag.from.classList.remove("dragging");
  drag.from.onpointermove = null;
  drag.from.onpointerup = null;
  drag.from.onpointercancel = null;
  drag = null;
  $("drop-mark").hidden = true;
}

// Brings the block playing, or else the one picked, into view.
function scrollToPlaying() {
  const block = document.querySelector("#lane .arr-block.playing") || document.querySelector("#lane .arr-block.selected");
  block?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/* What's playing, and what's coming up: a column for each block, with what each grid
   plays in it. Before Play, it shows how the song starts, or from the block picked. */

// A pattern's name, as the part menus show it.
function patternName(instrument, ref) {
  if (ref === null || ref === undefined) return "Off";
  if (instrument.library) return ref === Song.GRID ? "Grid pattern" : (td3Library().find((entry) => entry.id === ref)?.name || "(not in the library)");
  const kept = song.assets[instrument.name]?.patterns.find((entry) => entry.ref === ref);
  return kept ? kept.label : `${instrument.word || "Pattern"} ${ref + 1}`;
}

// The blocks to show: the one playing and the next two, as the song will go.
function upcomingBlocks() {
  if (!playback.on) {
    const played = Song.expand(song).sections;
    const from = Math.max(0, played.findIndex((item) => item.id === selected));
    return { title: selected ? "From the block picked" : "How it starts", items: played.slice(from, from + 3).map((item, offset) => ({ item, label: offset ? "Then" : "First" })) };
  }
  const target = playback.played;
  const at = Song.sectionAt(target, playback.sim.bar);
  if (!at) return { title: "Playing", items: [] };
  const items = [{ item: target.sections[at.index], label: `Now, bar ${at.bar + 1} of ${target.sections[at.index].bars}` }];
  // Follows the song ahead, with its loops and what's queued, to the next blocks that start.
  const look = JSON.parse(JSON.stringify(playback.sim));
  for (let step = 0; step < 4096 && items.length < 3; step += 1) {
    if (!Sync.songNextBar(look)) {
      items.push({ item: null, label: "End" });
      break;
    }
    const index = playback.starts.get(look.bar);
    if (index !== undefined) items.push({ item: target.sections[index], label: items.length === 1 ? (playback.queued ? "Up next" : "Next") : "Then" });
  }
  return { title: "Playing", items };
}

let upcomingKey = "";

function renderUpcoming(force = false) {
  const { title, items } = upcomingBlocks();
  const key = JSON.stringify([title, items.map((entry) => [entry.item?.id, entry.label]), effectiveMutes(), peers]);
  if (!force && key === upcomingKey) return;
  upcomingKey = key;
  $("upcoming-title").textContent = title;
  const head = document.createElement("tr");
  head.append(document.createElement("th"));
  for (const { item, label } of items) {
    const cell = document.createElement("th");
    cell.className = "upcoming-head";
    if (item) cell.style.setProperty("--part", partColour(item));
    cell.append(Object.assign(document.createElement("small"), { textContent: label }),
      Object.assign(document.createElement("span"), { textContent: item ? `${item.name}${item.loop ? " ∞" : ""}` : "The song ends" }));
    head.append(cell);
  }
  const rows = [head];
  const mutes = effectiveMutes();
  for (const instrument of Song.INSTRUMENTS) {
    const row = document.createElement("tr");
    row.classList.toggle("closed", !peers.includes(instrument.name));
    row.classList.toggle("silenced", mutes.includes(instrument.name));
    row.append(Object.assign(document.createElement("th"), { textContent: instrument.label }));
    for (const { item } of items) {
      const cell = document.createElement("td");
      if (item) {
        const ref = item.patterns[instrument.name];
        cell.append(Object.assign(document.createElement("span"), { textContent: patternName(instrument, ref) }));
        cell.classList.toggle("off", ref === null);
        if (item.bars > 1 && instrument.name in item.fills) {
          cell.append(Object.assign(document.createElement("small"), { textContent: `Fill: ${patternName(instrument, item.fills[instrument.name])}` }));
        }
      }
      row.append(cell);
    }
    rows.push(row);
  }
  if (!items.length) rows.push(Object.assign(document.createElement("tr"), { innerHTML: '<td class="muted">Nothing in the arranger yet.</td>' }));
  $("upcoming").replaceChildren(...rows);
  $("upcoming").classList.toggle("on", playback.on);
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
    if (at) {
      current = song.sections.findIndex((item) => item.id === target.sections[at.index].part);
      text = `Bar ${playback.sim.bar + 1} of ${total}: ${target.sections[at.index].name}, bar ${at.bar + 1}`;
      if (target.sections[at.index].loop) text += ", looping";
      if (playback.queued) text += `. Next: ${target.sections[playback.queued.index].name}`;
    }
  }
  $("position").textContent = text;
  document.querySelectorAll("#table td").forEach((cell) => {
    cell.classList.toggle("playing", current !== null && current >= 0 && Number(cell.dataset.section) === current);
  });
  renderProgress();
  if (prefs.tab === "arranger") renderUpcoming();
}

// Fills the bar under the section playing, as far through it as the song is.
function renderProgress() {
  let playing = null;
  let done = 0;
  let text = "";
  let bar = 0;
  if (playback.on) {
    const at = Song.sectionAt(playback.played, playback.sim.bar);
    if (at) {
      playing = playback.played.sections[at.index];
      const { bars } = playing;
      const inBar = (pulseAt(performance.now()) % BAR_PULSES) / BAR_PULSES;
      done = Math.min(1, (at.bar + Math.max(0, inBar)) / bars);
      text = `${at.bar + 1}/${bars}`;
      bar = playback.sim.bar + Math.max(0, inBar);
    }
  }
  // The playhead, where the arranger has the same blocks as the song playing.
  const same = playing && JSON.stringify(song.order.map((item) => item.id)) === JSON.stringify(playback.played.sections.map((item) => item.id));
  $("playhead").hidden = !same;
  if (same) $("playhead").style.left = `${8 + bar * prefs.zoom}px`;
  document.querySelectorAll("#lane .arr-block").forEach((block) => {
    const here = playing !== null && block.dataset.block === playing.id;
    block.classList.toggle("playing", here);
    block.querySelector(".block-fill").style.width = `${here ? done * 100 : 0}%`;
  });
  document.querySelectorAll(".section-play").forEach((cell) => {
    const here = playing !== null && cell.dataset.part === playing.part;
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

// When a bar of playback starts, in performance.now() time, at the tempo playing.
const timeOfBar = (played) => playback.anchorTime + (played * BAR_PULSES - playback.anchorPulse) * msPerPulse();

function tick() {
  if (!playback.on) return;
  const now = performance.now();
  // The grids stop themselves at the end, so this page only catches up, a bar at a time,
  // following each section's tempo from the bar it starts on, as the grids do.
  while (playback.sim.played < Math.floor(pulseAt(now) / BAR_PULSES)) {
    const start = timeOfBar(playback.sim.played + 1);
    if (!Sync.songNextBar(playback.sim)) {
      endOfSong();
      return;
    }
    const bpm = playback.tempos.get(playback.sim.bar);
    if (bpm && bpm !== playback.bpm) {
      retime(bpm, start);
      $("bpm").value = String(bpm);
    }
    const index = playback.starts.get(playback.sim.bar);
    if (take.on && index !== undefined) take.sections.push(index);
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
  const played = playback.played.sections.filter((section) => section.part === item.id);
  if (!played.length) return;
  for (const section of played) section.loop = item.loop;
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
  const { id, part } = target.sections[index];
  playback.queued = { index, id, part, atBar, move: playback.sim.moves[playback.sim.moves.length - 1] };
  render();
  setStatus(`Up next: "${target.sections[index].name}", when "${target.sections[playing.index].name}" finishes.`);
}

// Queues a part from Parts: its next block in the arranger after the one playing.
function queuePart(index) {
  if (!playback.on) return;
  const item = song.sections[index];
  const target = playback.played;
  if (playback.queued?.part === item.id) {
    queueSection(playback.queued.index);
    return;
  }
  const at = Song.sectionAt(target, playback.sim.bar)?.index ?? 0;
  const count = target.sections.length;
  for (let step = 1; step <= count; step += 1) {
    const look = (at + step) % count;
    if (target.sections[look].part === item.id) {
      queueSection(look);
      return;
    }
  }
  setStatus(`"${item.name}" isn't in the arranger${song.order.some((entry) => entry.part === item.id) ? " that's playing. It plays from the next Play" : ". Add it there first"}.`, true);
}

// Queues the block picked in the arranger.
function queueSelected() {
  if (!playback.on || !selected) return;
  const index = playback.played.sections.findIndex((item) => item.id === selected);
  if (index < 0) {
    setStatus("That block was added after Play was pressed, so it plays from the next Play.", true);
    return;
  }
  queueSection(index);
}

/* ---------- Count-in ---------- */

let audio = null;

// A click for each beat of the bar before the song starts, as this page makes no other sound.
function countIn(at, bpm) {
  try {
    audio ||= new AudioContext();
    audio.resume();
  } catch {
    return;
  }
  const beat = 60000 / bpm;
  for (let index = 0; index < 4; index += 1) {
    const when = audio.currentTime + (at - 4 * beat + index * beat - performance.now()) / 1000;
    if (when < audio.currentTime) continue;
    const tone = audio.createOscillator();
    const level = audio.createGain();
    tone.frequency.value = index === 0 ? 1500 : 1000;
    level.gain.setValueAtTime(0.4, when);
    level.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
    tone.connect(level).connect(audio.destination);
    tone.start(when);
    tone.stop(when + 0.07);
  }
}

function startPlaying() {
  if (!song.order.length) {
    setStatus("There's nothing in the arranger to play. Add parts to it first.", true);
    setPlaying = null;
    renderSetList();
    return;
  }
  if (!peers.some((name) => Song.INSTRUMENTS.some((item) => item.name === name))) {
    setStatus("Open the grids in this browser, with Sync ticked, to play the song.", true);
    setPlaying = null;
    renderSetList();
    return;
  }
  const plan = Song.plan(song, { mutes: effectiveMutes() });
  const bpm = Song.startBpm(song);
  link.announceSong(plan);
  const wait = prefs.countIn ? 4 * (60000 / bpm) : 0;
  const at = link.announcePlay(bpm, wait);
  if (at === null) {
    setStatus("Couldn't reach the grids. Reload this page and try again.", true);
    return;
  }
  if (wait) countIn(at, bpm);
  // Where each section starts, and its tempo when sections have their own.
  const played = Song.expand(JSON.parse(JSON.stringify(song)));
  const bounds = Song.bounds(played);
  const starts = new Map(bounds.map((range, index) => [range.start, index]));
  const tempos = new Map(played.sections.some((item) => item.bpm !== null)
    ? bounds.map((range, index) => [range.start, played.sections[index].bpm ?? song.bpm]) : []);
  Object.assign(playback, {
    on: true, anchorTime: at, anchorPulse: 0, bpm, queued: null, starts, tempos,
    played, sim: Sync.songStart({ bars: plan.bars, loop: plan.loop, loops: plan.loops }),
  });
  if (take.on) take.sections = [0];
  clearInterval(playback.timer);
  playback.timer = setInterval(tick, 100);
  render();
  requestAnimationFrame(animate);
  const playing = Song.INSTRUMENTS.filter((item) => peers.includes(item.name)).map((item) => item.label);
  const set = setPlaying !== null ? `, song ${setPlaying + 1} of ${setList.length} in the set` : "";
  const looped = setPlaying !== null && song.loop ? " It has Loop on, so the set won't go on past it until you turn Loop off." : "";
  setStatus(`${wait ? "Counting in, then playing" : "Playing"} "${song.name || "Untitled"}"${set} on ${playing.join(", ")}.${looped}`);
}

// Stops playing. A take being recorded is saved as a song.
function stopPlaying() {
  playback.on = false;
  playback.queued = null;
  clearInterval(playback.timer);
  $("bpm").value = String(song.bpm);
  const kept = saveTake();
  render();
  return kept;
}

function endOfSong() {
  const kept = stopPlaying();
  if (setPlaying !== null) {
    playSetSong(setPlaying + 1);
    return;
  }
  setStatus(`The song has ended.${kept ? ` ${kept}` : ""}`);
}

function togglePlay() {
  if (playback.on) {
    link.announceStop();
    setPlaying = null;
    renderSetList();
    const kept = stopPlaying();
    setStatus(`Stopped.${kept ? ` ${kept}` : ""}`);
  } else {
    startPlaying();
  }
}

/* ---------- Recording a take ---------- */

// Saves the sections played since recording started as a new song. Gives what it did.
function saveTake() {
  const played = take.sections;
  take.sections = [];
  if (!played.length || !playback.played) return "";
  const base = playback.played.name || "Untitled";
  const count = songs.filter((item) => item.song.name.startsWith(`${base} take`)).length + 1;
  const kept = Song.fromSections(playback.played, played, `${base} take ${count}`.slice(0, 40));
  songs.unshift({ id: newId(), song: kept, saved: new Date().toISOString() });
  writeJson(SONGS_KEY, songs);
  renderSongs();
  return `Saved the take as "${kept.name}" in Saved songs, with ${kept.order.length} block${kept.order.length === 1 ? "" : "s"}.`;
}

function toggleTake() {
  take.on = !take.on;
  $("record").setAttribute("aria-pressed", String(take.on));
  if (take.on) {
    take.sections = [];
    setStatus(playback.on ? "Recording a take from the next section." : "Recording a take when you press Play. Every section that plays, with your jumps and loops, is kept in order.");
  } else {
    const kept = playback.on ? saveTake() : "";
    setStatus(kept || "Stopped recording.");
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
  $("load-offer").hidden = true;
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

/* ---------- Adding pattern files to the assets ---------- */

// The files each grid saves its patterns as. MPC Grid's sequences live in its projects,
// so they're added from the grid with Add.
const FILE_TYPES = {
  "S-1 Grid": { description: "S-1 patch", accept: { "application/octet-stream": [".PRM"] } },
  "Protein Grid": { description: "Protein Grid pattern", accept: { "application/json": [".json"] } },
  "Bass Station Grid": { description: "Bass Station Grid pattern", accept: { "application/json": [".json"] } },
  "TD-3 Grid": { description: "TD-3 pattern", accept: { "application/octet-stream": [".syx"] } },
};

// Opens pattern files with the Mac's Open dialog, and has the grid read them with its own
// code, so they come in as it saves them, sound included. They're kept with the song.
async function addFiles(name) {
  const type = FILE_TYPES[name];
  if (!type || !("showOpenFilePicker" in window)) {
    setStatus("Adding files needs Chrome or Edge on a computer.", true);
    return;
  }
  let handles;
  try {
    handles = await window.showOpenFilePicker({ id: `song-grid-${labelOf(name).replace(/\W+/g, "-").toLowerCase()}`, types: [type], multiple: true });
  } catch (error) {
    if (error.name !== "AbortError") setStatus(`Couldn't open the files: ${error.message}`, true);
    return;
  }
  const files = await Promise.all(handles.map(async (handle) => {
    const file = await handle.getFile();
    return { name: file.name, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) };
  }));
  setStatus(`Asking ${labelOf(name)} to read ${files.length === 1 ? files[0].name : `${files.length} files`}...`);
  let got;
  try {
    got = await link.ask(name, "readFiles", { files }, 10000);
  } catch (error) {
    setStatus(`${labelOf(name)} couldn't read them: ${error.message}. Hard-refresh it to load the latest version, then try again.`, true);
    return;
  }
  const patterns = Array.isArray(got?.patterns) ? got.patterns : [];
  const skipped = Array.isArray(got?.skipped) ? got.skipped : [];
  let result = { added: 0, full: 0 };
  if (patterns.length) change(() => { result = Song.addAssets(song, name, { patterns }); });
  renderAssets();
  const parts = [];
  if (result.added) parts.push(`Added ${result.added} ${labelOf(name)} pattern${result.added === 1 ? "" : "s"} to the song's assets. Choose ${result.added === 1 ? "it" : "them"} in the parts.`);
  if (result.full) parts.push(`${result.full} didn't fit, as all ${Song.PATTERNS} pattern numbers hold one. Remove some from the assets first.`);
  if (skipped.length) parts.push(`${skipped.join(", ")} ${skipped.length === 1 ? "isn't a pattern" : "aren't patterns"} ${labelOf(name)} can read.`);
  setStatus(parts.join(" ") || "Nothing was added.", !result.added);
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

// Says what to do when a grid Song Grid needs isn't linked.
function notLinked(instrument) {
  setStatus(`${instrument.name} isn't linked. Open it (click "Not linked" under ${instrument.label} in the arrangement), or go to its tab if it's open, and tick Sync at its top. Then click Add again.`, true);
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
    else note.textContent = peers.includes(instrument.name) ? "Nothing kept yet" : "Not linked";
    const open = peers.includes(instrument.name);
    // Add stays clickable when the grid isn't linked, to say what to do.
    const button = toolButton("Add", open ? `Pick patterns${instrument.library || instrument.word ? "" : " and a sound"} from ${instrument.name} and its library to keep with this song` : `Open ${instrument.name}, with Sync ticked, to pick from it`,
      () => (open ? openPicker(instrument.name) : notLinked(instrument)), busy);
    const load = toolButton("Load", !hasAssets(instrument.name) ? "Nothing is kept from this grid yet"
      : open ? `Put this song's ${instrument.label} patterns${kept.sound ? " and sound" : ""} back into ${instrument.name}` : `Open ${instrument.name}, with Sync ticked, to put them back into it`,
    () => loadInto([instrument.name]), !open || !hasAssets(instrument.name) || busy);
    head.append(Object.assign(document.createElement("strong"), { textContent: instrument.label }), note, button);
    if (FILE_TYPES[instrument.name]) {
      head.append(toolButton("Add file\u2026", open ? `Choose ${instrument.label} pattern files on this computer to keep with this song` : `Open ${instrument.name}, with Sync ticked, to read its files`,
        () => (open ? addFiles(instrument.name) : notLinked(instrument)), busy));
    }
    head.append(load);
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
      renderSetList();
    });
    const add = toolButton("+", "Add this song to the set list", () => addToSet(item));
    add.className = "set-add";
    row.append(open, add, remove);
    return row;
  }));
}

function openSong(item, { offer = true } = {}) {
  if (playback.on) togglePlay();
  song = Song.cleanSong(JSON.parse(JSON.stringify(item.song)));
  songId = item.id;
  save();
  render();
  // Offers to put the song's patterns and sounds into the grids, so they match it.
  const assets = Song.INSTRUMENTS.some(({ name }) => hasAssets(name));
  $("load-offer").hidden = !offer || !assets;
  setStatus(`Opened "${song.name || "Untitled"}".${offer && assets ? " It has patterns and sounds kept with it: Load all puts them into the grids." : ""}`);
}

/* ---------- Set list ---------- */

const saveSetList = () => writeJson(SETLIST_KEY, setList);
const songById = (id) => songs.find((item) => item.id === id);

function renderSetList() {
  $("set-empty").hidden = setList.length > 0;
  $("play-set").textContent = setPlaying !== null ? "Stop set" : "Play set";
  $("play-set").disabled = !setList.length && setPlaying === null;
  $("set-list").replaceChildren(...setList.map((id, index) => {
    const item = songById(id);
    const row = document.createElement("li");
    row.classList.toggle("current", setPlaying === index);
    row.append(Object.assign(document.createElement("span"), { className: "set-number", textContent: `${index + 1}.` }),
      Object.assign(document.createElement("span"), { className: "set-name", textContent: item ? item.song.name || "Untitled" : "(deleted)" }));
    if (item?.song.loop) row.append(Object.assign(document.createElement("small"), { className: "muted", textContent: "Loops", title: "This song has Loop on, so the set won't go on past it" }));
    row.append(
      toolButton("\u2191", "Play it earlier", () => moveInSet(index, -1), index === 0),
      toolButton("\u2193", "Play it later", () => moveInSet(index, 1), index === setList.length - 1),
      toolButton("\u00d7", "Take it out of the set list", () => removeFromSet(index)),
    );
    return row;
  }));
}

function addToSet(item) {
  setList.push(item.id);
  saveSetList();
  renderSetList();
  setStatus(`Added "${item.song.name || "Untitled"}" to the set list, as song ${setList.length}.`);
}

function moveInSet(index, by) {
  const [id] = setList.splice(index, 1);
  setList.splice(index + by, 0, id);
  if (setPlaying === index) setPlaying += by;
  else if (setPlaying === index + by) setPlaying -= by;
  saveSetList();
  renderSetList();
}

function removeFromSet(index) {
  setList.splice(index, 1);
  if (setPlaying !== null && index <= setPlaying) setPlaying = index === setPlaying ? null : setPlaying - 1;
  saveSetList();
  renderSetList();
}

function toggleSet() {
  if (setPlaying !== null) {
    if (playback.on) togglePlay();
    setPlaying = null;
    renderSetList();
    setStatus("Stopped the set.");
    return;
  }
  playSetSong(0);
}

// Opens the set's next song, puts its assets into the grids if it has any, and plays it.
function playSetSong(index) {
  let at = index;
  while (at < setList.length && !songById(setList[at])) at += 1;
  if (at >= setList.length) {
    setPlaying = null;
    renderSetList();
    setStatus(index === 0 ? "The set list has no songs to play." : "The set has ended.");
    return;
  }
  const item = songById(setList[at]);
  setPlaying = at;
  openSong(item, { offer: false });
  setPlaying = at;
  renderSetList();
  const loading = Song.INSTRUMENTS.some(({ name }) => peers.includes(name) && hasAssets(name));
  if (!loading) {
    startPlaying();
    return;
  }
  loadInto(Song.INSTRUMENTS.map(({ name }) => name));
  // Gives the grids time to take the patterns in before it starts.
  setTimeout(() => { if (setPlaying === at && !playback.on) startPlaying(); }, 1500);
}

/* ---------- Exporting MIDI ---------- */

function exportMidi() {
  const { bytes, missing } = Song.toMidi(song);
  const tracks = bytes[11] - 1;
  if (!tracks) {
    setStatus("There are no notes to export. Keep the song's patterns with it first, in Assets, as the file is made from them.", true);
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/midi" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${(song.name || "song").replace(/[^\w .-]+/g, "").trim() || "song"}.mid`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const gaps = missing.length ? ` These aren't kept with the song, so they're silent in it: ${missing.join(", ")}.` : "";
  setStatus(`Downloaded ${anchor.download}, with ${tracks} track${tracks === 1 ? "" : "s"}. Each section plays once.${gaps}`, Boolean(missing.length));
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
  $("theme-toggle").textContent = light ? "☾" : "☀";
  try {
    localStorage.setItem(THEME_KEY, light ? "light" : "dark");
  } catch {
    // It's just not remembered.
  }
}

// Follows a switch made on another grid open in this browser.
window.addEventListener("storage", (event) => {
  if (event.key === THEME_KEY && event.newValue) setTheme(event.newValue === "light");
});

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
  $("record").onclick = toggleTake;
  $("count-in").checked = prefs.countIn;
  $("count-in").onchange = () => {
    prefs.countIn = $("count-in").checked;
    savePrefs();
  };
  $("more-toggle").onclick = () => {
    prefs.more = !prefs.more;
    savePrefs();
    render();
  };
  $("export-midi").onclick = exportMidi;
  $("play-set").onclick = toggleSet;
  $("offer-load").onclick = () => loadInto(Song.INSTRUMENTS.map((item) => item.name));
  $("offer-dismiss").onclick = () => { $("load-offer").hidden = true; };
  $("section-back").onclick = () => skipSection(-1);
  $("section-next").onclick = () => skipSection(1);
  $("add-section").onclick = () => copySection(song.sections.length - 1);
  $("tab-parts").onclick = () => showTab("parts");
  $("tab-arranger").onclick = () => showTab("arranger");
  $("block-copy").onclick = () => duplicateBlock();
  $("block-delete").onclick = () => deleteBlock();
  $("block-next").onclick = queueSelected;
  $("zoom-in").onclick = () => zoomBy(1);
  $("zoom-out").onclick = () => zoomBy(-1);
  $("zoom-fit").onclick = zoomToFit;
  // Pinch, or Ctrl or Cmd with the wheel, zooms where the pointer is.
  $("arranger-scroll").addEventListener("wheel", (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const now = performance.now();
    if (now - (zoomBy.last || 0) < 120) return;
    zoomBy.last = now;
    zoomBy(event.deltaY < 0 ? 1 : -1, event.clientX - $("arranger-scroll").getBoundingClientRect().left);
  }, { passive: false });
  // Clicking an empty part of the lane lets go of the block picked.
  $("lane").addEventListener("pointerdown", (event) => { if (event.target === $("lane")) select(null); });
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
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === " ") {
      event.preventDefault();
      togglePlay();
    } else if (event.key === "?") {
      $("help").showModal();
    } else if (event.key === "Tab" && !event.shiftKey && event.target === document.body) {
      event.preventDefault();
      showTab(prefs.tab === "parts" ? "arranger" : "parts");
    } else if (prefs.tab === "arranger" && (event.key === "Delete" || event.key === "Backspace") && selected) {
      event.preventDefault();
      deleteBlock();
    } else if (prefs.tab === "arranger" && event.key.toLowerCase() === "d" && selected) {
      duplicateBlock();
    } else if (prefs.tab === "arranger" && (event.key === "+" || event.key === "=")) {
      zoomBy(1);
    } else if (prefs.tab === "arranger" && event.key === "-") {
      zoomBy(-1);
    } else if (prefs.tab === "arranger" && event.key === "0") {
      zoomToFit();
    } else if (prefs.tab === "arranger" && !playback.on && selected && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      // Picks the block before or after.
      const index = song.order.findIndex((item) => item.id === selected);
      const next = song.order[index + (event.key === "ArrowLeft" ? -1 : 1)];
      if (next) {
        select(next.id);
        document.querySelector(`#lane [data-block="${next.id}"]`)?.focus();
      }
    } else if (/^[1-9]$/.test(event.key) && playback.on) {
      // Up next by number, as the blocks are counted left to right.
      const index = Number(event.key) - 1;
      if (index < playback.played.sections.length) queueSection(index);
    } else if (event.key.toLowerCase() === "l" && playback.on) {
      const at = Song.sectionAt(playback.played, playback.sim.bar);
      const index = at ? song.sections.findIndex((item) => item.id === playback.played.sections[at.index].part) : -1;
      if (index >= 0) toggleLoop(index);
    } else if (event.key === "ArrowLeft" && playback.on) {
      skipSection(-1);
    } else if (event.key === "ArrowRight" && playback.on) {
      skipSection(1);
    } else if (event.key.toLowerCase() === "r") {
      toggleTake();
    }
  });
  window.addEventListener("pagehide", () => { if (playback.on) link.announceStop(); });
}

restore();
setTheme(document.documentElement.dataset.theme === "light");
bind();
render();
renderSetList();
setStatus("Open the grids in this browser with Sync ticked, choose what each grid plays in each part, put the parts in order in the Arranger, then press Play.");
