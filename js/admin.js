/* Admin: parts & badges, unknown badge taps, users, links.
   Parts are read once per page visit; after saving, the local list is updated (no re-read). */
import {
  db, $, $$, esc, toast, fmtDate, pnKey, requireUser, friendlyError, downloadCSV, parseCSV, todayStr,
  ROLES, SETTINGS, EMU, auth,
} from "./common.js";
import { firebaseConfig } from "./firebase-config.js";
import {
  initializeApp, initializeAuth, inMemoryPersistence, connectAuthEmulator, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail,
  collection, doc, getDocs, setDoc, updateDoc, onSnapshot, writeBatch, serverTimestamp, query, orderBy, limit,
} from "./fb.js";

const me = await requireUser(["admin"]);
document.body.classList.remove("loading");

let parts = [], unknown = [], users = null;
const badgeDocId = b => encodeURIComponent(b).replace(/\./g, "%2E");

/* ---------------- Tabs ---------------- */
$$("[data-atab]").forEach(t => t.addEventListener("click", () => {
  $$("[data-atab]").forEach(x => x.classList.toggle("active", x === t));
  $$("[data-apanel]").forEach(p => p.classList.toggle("hidden", p.dataset.apanel !== t.dataset.atab));
  if (t.dataset.atab === "users" && !users) loadUsers();
}));

/* ---------------- Links ---------------- */
const base = location.href.replace(/[^/]*$/, "");
$("#lOrders").textContent = base;
$("#lBoard").textContent = base + "board.html";
$("#lKiosk").textContent = base + "kiosk.html";
$("#lDays").textContent = SETTINGS.boardDays;

/* ---------------- Parts ---------------- */
async function loadParts() {
  try {
    const snap = await getDocs(collection(db, "parts"));
    parts = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.partNumber.localeCompare(b.partNumber));
  } catch (e) { toast(friendlyError(e), "err"); }
  renderParts(); renderUnknown();
}

function renderParts() {
  const q = $("#pSearch").value.trim().toLowerCase();
  const list = parts.filter(p => !q || [p.partNumber, p.description, p.badgeId, p.vendor, p.location]
    .some(v => (v || "").toLowerCase().includes(q)));
  $("#pTbl tbody").innerHTML = list.map(p => `<tr>
    <td class="pn">${esc(p.partNumber)}</td>
    <td>${esc(p.description)}</td>
    <td>${p.badgeId ? `<code>${esc(p.badgeId)}</code>` : '<span class="sub">— none —</span>'}</td>
    <td class="num">${p.orderQty}</td>
    <td>${esc(p.vendor)}</td>
    <td>${esc(p.location)}</td>
    <td>${p.orderUrl ? `<a href="${esc(p.orderUrl)}" target="_blank" rel="noopener">open ↗</a>` : '<span class="sub">none</span>'}</td>
    <td>${p.active ? (p.pendingRequestId ? '<span class="pill pending">Pending</span>' : '<span class="pill received">Active</span>') : '<span class="pill inactive">Inactive</span>'}</td>
    <td>${fmtDate(p.lastRequestAt)}</td>
    <td class="actions"><button class="btn sm" data-edit="${p.id}">Edit</button></td></tr>`).join("");
  $("#pEmpty").classList.toggle("hidden", list.length > 0);
}

function normalizePart(d) {
  let url = (d.orderUrl || "").trim();
  if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
  const p = {
    partNumber: (d.partNumber || "").trim(),
    description: (d.description || "").trim(),
    badgeId: (d.badgeId || "").replace(/\s+/g, "") || null,
    orderQty: parseInt(d.orderQty, 10) || 0,
    orderUrl: url, vendor: (d.vendor || "").trim(), location: (d.location || "").trim(),
    active: d.active !== false,
  };
  if (!p.partNumber) throw new Error("Part number is required");
  if (p.orderQty < 1) throw new Error("Order qty must be at least 1");
  p.pnKey = pnKey(p.partNumber);
  return p;
}
function checkUnique(p, id) {
  const dupPn = parts.find(x => x.id !== id && x.pnKey === p.pnKey);
  if (dupPn) throw new Error(`Part number ${p.partNumber} already exists`);
  if (p.badgeId) {
    const dupB = parts.find(x => x.id !== id && x.badgeId && x.badgeId.toLowerCase() === p.badgeId.toLowerCase());
    if (dupB) throw new Error(`Badge ${p.badgeId} is already assigned to ${dupB.partNumber}`);
  }
}
async function savePart(data, id) {
  const p = normalizePart(data);
  checkUnique(p, id);
  const bt = writeBatch(db);
  const ref = id ? doc(db, "parts", id) : doc(collection(db, "parts"));
  if (id) bt.update(ref, { ...p, updatedAt: serverTimestamp() });
  else bt.set(ref, { ...p, pendingRequestId: null, pendingSince: null, lastRequestAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  if (p.badgeId && unknown.some(u => u.badgeId === p.badgeId)) bt.delete(doc(db, "unknownScans", badgeDocId(p.badgeId)));
  await bt.commit();
  const old = parts.find(x => x.id === ref.id);
  const merged = { ...(old || { pendingRequestId: null, lastRequestAt: null }), ...p, id: ref.id };
  parts = parts.filter(x => x.id !== ref.id).concat(merged).sort((a, b) => a.partNumber.localeCompare(b.partNumber));
  renderParts(); renderUnknown();
  return merged;
}

function openPart(p = {}) {
  $("#pdTitle").textContent = p.id ? `Edit ${p.partNumber}` : "Add part";
  $("#pdId").value = p.id || "";
  $("#pdPn").value = p.partNumber || "";
  $("#pdBadge").value = p.badgeId || "";
  $("#pdDesc").value = p.description || "";
  $("#pdQty").value = p.orderQty || 1;
  $("#pdVendor").value = p.vendor || "";
  $("#pdUrl").value = p.orderUrl || "";
  $("#pdLoc").value = p.location || "";
  $("#pdActive").checked = p.active === undefined ? true : !!p.active;
  $("#pdDelete").classList.toggle("hidden", !p.id);
  $("#pdErr").textContent = "";
  $("#partDlg").showModal();
  (p.partNumber ? $("#pdDesc") : $("#pdPn")).focus();
}
// Badge readers type the ID + Enter: don't let Enter submit the form from the badge field.
$("#pdBadge").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("#pdDesc").focus(); } });
$("#partForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await savePart({
      partNumber: $("#pdPn").value, badgeId: $("#pdBadge").value, description: $("#pdDesc").value,
      orderQty: $("#pdQty").value, vendor: $("#pdVendor").value, orderUrl: $("#pdUrl").value,
      location: $("#pdLoc").value, active: $("#pdActive").checked,
    }, $("#pdId").value || null);
    $("#partDlg").close(); toast("Part saved");
  } catch (err) { $("#pdErr").textContent = friendlyError(err); }
});
$("#pdCancel").addEventListener("click", () => $("#partDlg").close());
$("#pdDelete").addEventListener("click", async () => {
  const p = parts.find(x => x.id === $("#pdId").value); if (!p) return;
  if (p.lastRequestAt || p.pendingRequestId) { $("#pdErr").textContent = "This part has order history. Untick 'Active' instead."; return; }
  if (!confirm(`Delete ${p.partNumber} permanently?`)) return;
  try {
    const bt = writeBatch(db); bt.delete(doc(db, "parts", p.id)); await bt.commit();
    parts = parts.filter(x => x.id !== p.id); renderParts(); renderUnknown();
    $("#partDlg").close(); toast("Part deleted");
  } catch (err) { $("#pdErr").textContent = friendlyError(err); }
});
$("#btnAdd").addEventListener("click", () => openPart());
$("#pSearch").addEventListener("input", renderParts);
$("#pTbl").addEventListener("click", e => {
  const b = e.target.closest("[data-edit]"); if (b) openPart(parts.find(p => p.id === b.dataset.edit));
});

$("#btnExport").addEventListener("click", () => {
  downloadCSV(`parts-${todayStr()}.csv`, ["part_number", "description", "badge_id", "order_qty", "order_url", "vendor", "location", "active"],
    parts.map(p => [p.partNumber, p.description, p.badgeId || "", p.orderQty, p.orderUrl, p.vendor, p.location, p.active ? 1 : 0]));
});
$("#importFile").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = "";
  const rows = parseCSV(await f.text());
  if (!rows.length) { toast("CSV is empty", "err"); return; }
  const hdr = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
  if (!hdr.includes("part_number")) { toast("CSV must have a 'part_number' column header", "err"); return; }
  const get = (r, k) => { const i = hdr.indexOf(k); return i >= 0 ? (r[i] || "").trim() : ""; };
  let added = 0, updated = 0; const errors = [];
  let bt = writeBatch(db), ops = 0;
  const pending = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    try {
      const p = normalizePart({ partNumber: get(r, "part_number"), description: get(r, "description"), badgeId: get(r, "badge_id"),
        orderQty: get(r, "order_qty") || "1", orderUrl: get(r, "order_url"), vendor: get(r, "vendor"), location: get(r, "location") });
      const ex = parts.find(x => x.pnKey === p.pnKey);
      checkUnique(p, ex ? ex.id : "__new__");
      if (pending.some(x => x.pnKey === p.pnKey)) throw new Error(`${p.partNumber} appears twice in the file`);
      if (p.badgeId && pending.some(x => x.badgeId && x.badgeId === p.badgeId)) throw new Error(`badge ${p.badgeId} appears twice in the file`);
      const ref = ex ? doc(db, "parts", ex.id) : doc(collection(db, "parts"));
      if (ex) { const { active, ...rest } = p; bt.update(ref, { ...rest, updatedAt: serverTimestamp() }); updated++; }
      else { bt.set(ref, { ...p, pendingRequestId: null, pendingSince: null, lastRequestAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); added++; }
      pending.push({ ...p, id: ref.id });
      if (++ops >= 400) { await bt.commit(); bt = writeBatch(db); ops = 0; }
    } catch (err) { errors.push(`Row ${i + 1}: ${err.message}`); }
  }
  try { if (ops) await bt.commit(); } catch (err) { toast(friendlyError(err), "err"); return; }
  alert(`Import finished.\nAdded: ${added}\nUpdated: ${updated}` + (errors.length ? `\n\nProblems:\n${errors.join("\n")}` : ""));
  loadParts();
});

/* ---------------- Unknown badge taps (small live list) ---------------- */
onSnapshot(query(collection(db, "unknownScans"), orderBy("lastSeen", "desc"), limit(50)), snap => {
  unknown = snap.docs.map(d => ({ docId: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
  renderUnknown();
}, err => toast(friendlyError(err), "err"));

function renderUnknown() {
  const free = parts.filter(p => !p.badgeId);
  const opts = '<option value="">Assign to existing part…</option>' +
    free.map(p => `<option value="${p.id}">${esc(p.partNumber)} — ${esc(p.description)}</option>`).join("");
  $("#unkTbl tbody").innerHTML = unknown.map(u => `<tr>
    <td><code>${esc(u.badgeId)}</code></td><td>${fmtDate(u.lastSeen)}</td><td>${u.count || 1}</td>
    <td class="actions">
      <select data-assign="${esc(u.badgeId)}">${opts}</select>
      <button class="btn primary sm" data-newbadge="${esc(u.badgeId)}">New part</button>
      <button class="btn danger sm" data-dismiss="${esc(u.docId)}" title="Dismiss">✕</button>
    </td></tr>`).join("");
  $("#unkTbl thead").classList.toggle("hidden", unknown.length === 0);
  $("#unkEmpty").classList.toggle("hidden", unknown.length > 0);
}
$("#unkTbl").addEventListener("click", async e => {
  const nb = e.target.closest("[data-newbadge]"), dm = e.target.closest("[data-dismiss]");
  if (nb) openPart({ badgeId: nb.dataset.newbadge });
  if (dm) {
    try { const bt = writeBatch(db); bt.delete(doc(db, "unknownScans", dm.dataset.dismiss)); await bt.commit(); }
    catch (err) { toast(friendlyError(err), "err"); }
  }
});
$("#unkTbl").addEventListener("change", async e => {
  const s = e.target.closest("[data-assign]"); if (!s || !s.value) return;
  const p = parts.find(x => x.id === s.value);
  try { await savePart({ ...p, badgeId: s.dataset.assign }, p.id); toast(`Badge assigned to ${p.partNumber}`); }
  catch (err) { toast(friendlyError(err), "err"); s.value = ""; }
});

/* ---------------- Users ---------------- */
$("#udRole").innerHTML = Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
const ROLE_PILL = { admin: "pending", buyer: "ordered", viewer: "inactive", kiosk: "received" };

async function loadUsers() {
  try {
    const snap = await getDocs(collection(db, "users"));
    users = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  } catch (e) { toast(friendlyError(e), "err"); users = []; }
  renderUsers();
}
function renderUsers() {
  $("#uTbl tbody").innerHTML = users.map(u => `<tr>
    <td><b>${esc(u.name)}</b>${u.id === me.uid ? ' <span class="sub">(you)</span>' : ""}</td><td>${esc(u.email)}</td>
    <td><span class="pill ${ROLE_PILL[u.role] || ""}">${esc(u.role)}</span></td>
    <td>${u.active ? '<span class="pill received">Active</span>' : '<span class="pill inactive">Disabled</span>'}</td>
    <td>${fmtDate(u.createdAt, false)}</td>
    <td class="actions"><button class="btn sm" data-uedit="${u.id}">Edit</button></td></tr>`).join("");
}
function genPw() {
  const c = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...crypto.getRandomValues(new Uint32Array(10))].map(n => c[n % c.length]).join("");
}
function openUser(u = {}) {
  const isNew = !u.id;
  $("#udTitle").textContent = isNew ? "Add user" : `Edit ${u.name}`;
  $("#udId").value = u.id || "";
  $("#udName").value = u.name || "";
  $("#udEmail").value = u.email || "";
  $("#udEmail").disabled = !isNew;            // login email can't be changed from the browser
  $("#udRole").value = u.role || "buyer";
  $("#udActive").checked = isNew ? true : !!u.active;
  $("#udPw").value = isNew ? genPw() : "";
  $("#udPwField").classList.toggle("hidden", !isNew);
  $("#udResetField").classList.toggle("hidden", isNew);
  $("#udErr").textContent = "";
  $("#userDlg").showModal();
  $("#udName").focus();
}
$("#btnAddUser").addEventListener("click", () => openUser());
$("#udGen").addEventListener("click", () => { $("#udPw").value = genPw(); });
$("#udCancel").addEventListener("click", () => $("#userDlg").close());
$("#uTbl").addEventListener("click", e => {
  const b = e.target.closest("[data-uedit]"); if (b) openUser(users.find(u => u.id === b.dataset.uedit));
});
$("#udReset").addEventListener("click", async () => {
  const email = $("#udEmail").value;
  try { await sendPasswordResetEmail(auth, email); toast(`Password reset email sent to ${email}`); }
  catch (err) { $("#udErr").textContent = friendlyError(err); }
});

// A second, in-memory Firebase app creates new logins without signing the admin out.
let secondAuth = null;
function getSecondAuth() {
  if (!secondAuth) {
    const app2 = initializeApp(firebaseConfig, "user-creator");
    secondAuth = initializeAuth(app2, { persistence: inMemoryPersistence });
    if (EMU) connectAuthEmulator(secondAuth, "http://127.0.0.1:9099", { disableWarnings: true });
  }
  return secondAuth;
}

$("#userForm").addEventListener("submit", async e => {
  e.preventDefault();
  const id = $("#udId").value;
  const name = $("#udName").value.trim(), email = $("#udEmail").value.trim().toLowerCase();
  const role = $("#udRole").value, active = $("#udActive").checked, pw = $("#udPw").value;
  if (!name || !email) { $("#udErr").textContent = "Name and email are required"; return; }
  if (id === me.uid && (role !== "admin" || !active)) { $("#udErr").textContent = "You can't remove your own admin role or deactivate yourself"; return; }
  $("#udSave").disabled = true;
  try {
    if (id) {
      await updateDoc(doc(db, "users", id), { name, role, active, updatedAt: serverTimestamp() });
      Object.assign(users.find(u => u.id === id), { name, role, active });
      toast("User saved");
    } else {
      if (pw.length < 6) throw new Error("Password must be at least 6 characters");
      if (users.some(u => (u.email || "").toLowerCase() === email)) throw new Error("This email is already in the list - edit it instead.");
      const a2 = getSecondAuth();
      const cred = await createUserWithEmailAndPassword(a2, email, pw);
      await signOut(a2);
      const rec = { email, name, role, active, createdAt: serverTimestamp() };
      await setDoc(doc(db, "users", cred.user.uid), rec);
      users.push({ id: cred.user.uid, ...rec, createdAt: new Date() });
      users.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      toast(`User created. Login: ${email}  Password: ${pw}`);
    }
    renderUsers(); $("#userDlg").close();
  } catch (err) {
    $("#udErr").textContent = err.code?.includes("email-already-in-use")
      ? "This email already has a Firebase login (maybe created earlier). Remove it in Firebase console → Authentication, then add again."
      : friendlyError(err);
  }
  $("#udSave").disabled = false;
});

loadParts();
