/* Shared: Firebase init, sign-in guard, header, helpers, sounds, CSV. */
import {
  initializeApp, getAuth, connectAuthEmulator, onAuthStateChanged, signOut,
  getFirestore, connectFirestoreEmulator, doc, getDoc, collection, runTransaction, serverTimestamp,
} from "./fb.js";
import { firebaseConfig, SETTINGS } from "./firebase-config.js";

export { SETTINGS };
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Local testing only: open http://localhost:.../?emulator to use the Firebase emulators.
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
if (isLocal && new URLSearchParams(location.search).has("emulator")) localStorage.setItem("useEmulator", "1");
export const EMU = isLocal && localStorage.getItem("useEmulator") === "1";
if (EMU) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

export const ROLES = {
  admin: "Admin - everything incl. parts & users",
  buyer: "Buyer - place orders, add/cancel requests",
  viewer: "Viewer - can only look",
  kiosk: "Kiosk - badge station login only",
};

/* ---------- DOM helpers ---------- */
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function toast(msg, kind = "ok") {
  const t = $("#toast"); if (!t) return;
  t.textContent = msg; t.className = "toast show " + kind;
  clearTimeout(t._h); t._h = setTimeout(() => (t.className = "toast"), 4500);
}

/* Firestore Timestamp | Date | "YYYY-MM-DD" -> readable text */
export function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === "string") return new Date(v.length <= 10 ? v + "T00:00:00" : v);
  return null;
}
export function fmtDate(v, withTime = true) {
  const d = toDate(v); if (!d || isNaN(d)) return "";
  const o = { year: "numeric", month: "short", day: "numeric" };
  if (withTime && !(typeof v === "string" && v.length <= 10)) Object.assign(o, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleString(undefined, o);
}
export function isoLocal(v) {           // -> "2026-11-06 14:05" for CSV
  const d = toDate(v); if (!d || isNaN(d)) return "";
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function todayStr() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const pnKey = s => String(s || "").trim().toUpperCase();

export function friendlyError(e) {
  const c = e?.code || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found") || c.includes("invalid-email"))
    return "Wrong email or password.";
  if (c.includes("too-many-requests")) return "Too many attempts. Wait a few minutes and try again.";
  if (c.includes("permission-denied")) return "You don't have permission to do that.";
  if (c.includes("email-already-in-use")) return "This email already has a login.";
  if (c.includes("weak-password")) return "Password must be at least 6 characters.";
  if (c.includes("resource-exhausted")) return "Daily free Firebase limit reached - it resets at midnight (US Pacific).";
  if (c.includes("unavailable") || c.includes("network")) return "No connection to the server. Check the internet.";
  return e?.message || String(e);
}

/* ---------- Sign-in guard + header ---------- */
let _profile = null;
export function currentProfile() { return _profile; }

/** Waits for sign-in, loads users/{uid}, checks role. Redirects if not allowed. */
export function requireUser(roles) {
  return new Promise(resolve => {
    const off = onAuthStateChanged(auth, async u => {
      off();
      const here = location.pathname.split("/").pop() || "orders.html";
      if (!u) { location.replace("index.html?next=" + encodeURIComponent(here)); return; }
      let p = null;
      try { const s = await getDoc(doc(db, "users", u.uid)); p = s.exists() ? s.data() : null; } catch (_) { /* denied */ }
      if (!p || p.active !== true) {
        await signOut(auth);
        location.replace("index.html?error=" + encodeURIComponent("Your account is not active. Ask the admin."));
        return;
      }
      _profile = { uid: u.uid, email: u.email, name: p.name || u.email, role: p.role };
      if (!roles.includes(p.role)) {
        if (p.role === "kiosk") { location.replace("kiosk.html"); return; }
        document.body.innerHTML = `<main><div class="card login-box"><h1>Not allowed</h1><p>Your role (${esc(p.role)}) can't open this page.</p><p><a href="orders.html">Go to orders</a></p></div></main>`;
        return;
      }
      renderNav();
      document.body.dataset.role = p.role;
      resolve(_profile);
    });
  });
}

export function renderNav() {
  const nav = $("#nav"); if (!nav || !_profile) return;
  nav.innerHTML = `<a href="orders.html">Orders</a>
    ${_profile.role === "admin" ? '<a href="admin.html">Admin</a>' : ""}
    <a href="board.html" target="_blank">Board ↗</a>
    <a href="account.html" class="who" title="My account / change password">👤 ${esc(_profile.name)} (${esc(_profile.role)})</a>
    <a href="#" id="signOut">Sign out</a>`;
  $("#signOut").onclick = async e => { e.preventDefault(); await signOut(auth); location.href = "index.html"; };
  $$(".site-name").forEach(el => (el.textContent = SETTINGS.siteName));
}

/* ---------- Create a reorder request (kiosk + manual), duplicate-safe ---------- */
export async function createRequest(partId, { by, byEmail, source, qty }) {
  const partRef = doc(db, "parts", partId);
  const reqRef = doc(collection(db, "requests"));
  return runTransaction(db, async tx => {
    const ps = await tx.get(partRef);
    if (!ps.exists()) throw new Error("Part not found");
    const p = ps.data();
    if (p.pendingRequestId) return { result: "duplicate", part: { id: partId, ...p } };
    const q = Number(qty) || p.orderQty || 1;
    tx.set(reqRef, {
      partId, partNumber: p.partNumber, pnKey: pnKey(p.partNumber), description: p.description || "",
      location: p.location || "", orderUrl: p.orderUrl || "", partVendor: p.vendor || "",
      qtyNeeded: q, requestedAt: serverTimestamp(), requestedBy: by, requestedByEmail: byEmail || "",
      source, status: "pending",
    });
    tx.set(doc(db, "board", reqRef.id), {
      partNumber: p.partNumber, description: p.description || "", qty: q, status: "pending",
      requestedAt: serverTimestamp(),
    });
    tx.update(partRef, { pendingRequestId: reqRef.id, pendingSince: serverTimestamp(), lastRequestAt: serverTimestamp() });
    return { result: "created", part: { id: partId, ...p }, qty: q, requestId: reqRef.id };
  });
}

/* ---------- Sounds (WebAudio, no files) ---------- */
export const Sound = (() => {
  let ctx = null;
  const ensure = () => { if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (C) ctx = new C(); } return ctx; };
  function tone(f, start, dur, type = "sine", vol = 0.25) {
    const c = ensure(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, c.currentTime + start);
    g.gain.exponentialRampToValueAtTime(vol, c.currentTime + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + start); o.stop(c.currentTime + start + dur + 0.05);
  }
  return {
    unlocked: () => { const c = ensure(); return c && c.state === "running"; },
    unlock: () => { const c = ensure(); if (c && c.state !== "running") c.resume(); },
    chime() { tone(880, 0, 0.35); tone(1175, 0.18, 0.35); tone(1568, 0.36, 0.6); },
    success() { tone(988, 0, 0.15); tone(1319, 0.12, 0.35); },
    warn() { tone(660, 0, 0.18, "square", 0.12); tone(660, 0.25, 0.18, "square", 0.12); },
    error() { tone(220, 0, 0.5, "sawtooth", 0.15); },
  };
})();
export function setupSoundBanner(sel = "#soundBanner") {
  const b = $(sel);
  const check = () => { if (b) b.classList.toggle("hidden", Sound.unlocked()); };
  ["click", "keydown", "touchstart"].forEach(ev =>
    document.addEventListener(ev, () => { Sound.unlock(); setTimeout(check, 100); }, { passive: true }));
  setTimeout(check, 300);
}

/* ---------- CSV ---------- */
export function downloadCSV(filename, header, rows) {
  const cell = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = [header, ...rows].map(r => r.map(cell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" }));
  a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function parseCSV(text) {
  const rows = []; let row = [], f = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f); f = ""; if (row.some(x => x.trim() !== "")) rows.push(row); row = [];
    } else f += c;
  }
  row.push(f); if (row.some(x => x.trim() !== "")) rows.push(row);
  return rows;
}
