'use strict';
const { app } = require('electron');
const path = require('path');
const fs   = require('fs');

let _data = null;

function dataPath() {
  return path.join(app.getPath('userData'), 'sudata.json');
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(dataPath(), 'utf8'));
  } catch {
    return { library: {}, wishlist: [], settings: {} };
  }
}

function get() {
  if (!_data) _data = load();
  return _data;
}

function save() {
  const p = dataPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(get(), null, 2));
}

// ── Library ───────────────────────────────────────────────────
function getLibrary() {
  return Object.entries(get().library).map(([id, v]) => ({ id, ...v }));
}

function upsertLibrary(id, fields) {
  const d = get();
  d.library[id] = Object.assign(d.library[id] || {}, fields);
  save();
}

function removeLibrary(id) {
  delete get().library[id];
  save();
}

function getLibraryEntry(id) {
  return get().library[id] || null;
}

function resetInterrupted() {
  const d = get();
  let changed = false;
  for (const [id, entry] of Object.entries(d.library)) {
    if (entry.status === 'downloading' || entry.status === 'extracting') {
      d.library[id].status = 'failed';
      d.library[id].statusMsg = 'Interrupted';
      changed = true;
    }
  }
  if (changed) save();
}

// ── Wishlist ──────────────────────────────────────────────────
function getWishlist() { return get().wishlist || []; }
function isWishlisted(id) { return (get().wishlist || []).some(g => g.id === id); }

function toggleWishlist(game) {
  const d = get();
  if (!d.wishlist) d.wishlist = [];
  const idx = d.wishlist.findIndex(g => g.id === game.id);
  if (idx >= 0) { d.wishlist.splice(idx, 1); save(); return false; }
  d.wishlist.push(game); save(); return true;
}

// ── Settings ──────────────────────────────────────────────────
function getSettings() {
  return get().settings || {};
}

function saveSettings(settings) {
  const d = get();
  d.settings = Object.assign(d.settings || {}, settings);
  save();
}

module.exports = {
  getLibrary, upsertLibrary, removeLibrary, getLibraryEntry, resetInterrupted,
  getWishlist, isWishlisted, toggleWishlist,
  getSettings, saveSettings,
};
