"use strict";

function cryptoRandom(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, value => alphabet[value % alphabet.length]).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function roundScore(value) {
  return Math.round(value * 100) / 100;
}

function characterDefinition(id) {
  return CHARACTERS.find(character => character.id === id);
}

function skillDefinition(id) {
  return SKILL_CARDS.find(card => card.id === id);
}

function eventDefinition(id) {
  return EVENT_CARDS.find(card => card.id === id);
}

function globalModifierDefinition(id) {
  return GLOBAL_MODIFIERS.find(modifier => modifier.id === id);
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomDimension(includeSelection = false) {
  return randomItem(includeSelection ? DIMENSIONS : CHANGEABLE_DIMENSIONS);
}

function ok(extra = {}) { return { ok: true, ...extra }; }
function fail(reason) { return { ok: false, reason }; }

function formatNumber(value) {
  return Number.isInteger(value) ? value : roundScore(value);
}
