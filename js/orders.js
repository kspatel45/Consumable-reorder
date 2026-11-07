/* Orders page: Pending (live) / Already ordered (paged) tabs. Built to keep Firebase reads low:
   - Pending tab: one live listener on pending requests only (reads only what changes).
   - Already ordered: loads 50 rows at a time, only when the tab is opened. */
import {
  db, $, $$, esc, toast, fmtDate, isoLocal, todayStr, toDate, pnKey, requireUser, createRequest,
  Sound, setupSoundBanner, downloadCSV, friendlyError, SETTINGS,
} from "./common.js";
import {
  collection, doc, query, where, orderBy, limit, startAfter, onSnapshot, getDocs, writeBatch,
  serverTimestamp, Timestamp,
} from "./fb.js";

const me = await requireUser(["admin", "buyer", "viewer"]);
document.body.classList.remove("loading");
const CAN_ORDER = ["admin", "buyer"].includes(me.role);
const PAGE = SETTINGS.orderedPageSize;

const state = {
  tab: "pending",
  pending: [],        // live
  ordered: [], orderedCursor: null, orderedMore: false, orderedMode: "range",
  flash: new Set(), current: null, parts: null,
};
const snapOpts = { serverTimestamps: "estimate" };
const rowOf = d => ({ id: d.id, ...d.data(snapOpts) });

const COLS = {
  pending: ["Requested", "Part #", "Description", "Location", "Qty to order", "Requested by", ""],
  ordered: ["Requested", "Ordered", "Part #", "Description", "Qty ordered", "When coming", "PO #", "Vendor", "Ordered by", "Status", ""],
};

/* ---------------- Pending: live listener (also drives the notification sound) ---------------- */
let firstSnap = true;
onSnapshot(query(collection(db, "requests"), where("status", "==", "pending")), snap => {
  state.pending = snap.docs.map(rowOf).sort((a, b) => (toDate(b.requestedAt) || 0) - (toDate(a.requestedAt) || 0));
  if (!firstSnap) {
    const added = snap.docChanges().filter(c => c.type === "added").map(c => rowOf(c.doc));
    if (added.length) {
      Sound.chime();
      const r = added[0];
      toast(`🔔 New request: ${r.partNumber} × ${r.qtyNeeded}`);
      added.forEach(a => state.flash.add(a.id));
    }
  }
  firstSnap = false;
  const n = state.pending.length, c = $("#pendingCount");
  c.textContent = n; c.classList.toggle("zero", n === 0);
  document.title = (n ? `(${n}) ` : "") + "Orders";
  if (state.tab === "pending") render();
}, err => toast(friendlyError(err), "err"));

/* ---------------- Already ordered: paged, on demand ---------------- */
async function loadOrdered(reset = true) {
  const text = pnKey($("#fPn").value);
  const s = $("#fStart").value, e = $("#fEnd").value;
  const col = collection(db, "requests");
  let q;
  try {
    if (text) {
      // Part-number search across ALL history (prefix match), date filter applied on the results.
      state.orderedMode = "search";
      q = query(col, where("pnKey", ">=", text), where("pnKey", "<=", text + ""), orderBy("pnKey"), limit(300));
      const snap = await getDocs(q);
      state.ordered = snap.docs.map(rowOf)
        .filter(r => r.status === "ordered" || r.status === "received")
        .filter(r => inRange(r.orderedAt, s, e))
        .sort((a, b) => (toDate(b.orderedAt) || 0) - (toDate(a.orderedAt) || 0));
      state.orderedMore = false;
    } else {
      state.orderedMode = "range";
      const parts = [orderBy("orderedAt", "desc")];
      if (s) parts.push(where("orderedAt", ">=", Timestamp.fromDate(new Date(s + "T00:00:00"))));
      if (e) parts.push(where("orderedAt", "<=", Timestamp.fromDate(new Date(e + "T23:59:59.999"))));
      if (!reset && state.orderedCursor) parts.push(startAfter(state.orderedCursor));
      parts.push(limit(PAGE));
      const snap = await getDocs(query(col, ...parts));
      const rows = snap.docs.map(rowOf);
      state.ordered = reset ? rows : state.ordered.concat(rows);
      state.orderedCursor = snap.docs[snap.docs.length - 1] || state.orderedCursor;
      state.orderedMore = snap.docs.length === PAGE;
    }
  } catch (err) { toast(friendlyError(err), "err"); }
  render();
}

function inRange(v, s, e) {
  const d = toDate(v); if (!d) return !s && !e;
  const p = n => String(n).padStart(2, "0");
  const k = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return (!s || k >= s) && (!e || k <= e);
}

function visibleRows() {
  if (state.tab === "ordered") return state.ordered;
  const t = $("#fPn").value.trim().toLowerCase(), s = $("#fStart").value, e = $("#fEnd").value;
  return state.pending.filter(r =>
    (!t || r.partNumber.toLowerCase().includes(t) || (r.description || "").toLowerCase().includes(t)) &&
    inRange(r.requestedAt, s, e));
}

/* ---------------- Render ---------------- */
function render() {
  $("#tbl thead").innerHTML = "<tr>" + COLS[state.tab].map(c => `<th>${c}</th>`).join("") + "</tr>";
  const today = todayStr();
  const list = visibleRows();
  $("#tbl tbody").innerHTML = list.map(r => {
    const fl = state.flash.has(r.id) ? ' class="flash"' : "";
    if (state.tab === "pending") {
      return `<tr${fl}>
        <td>${fmtDate(r.requestedAt)}</td>
        <td class="pn">${esc(r.partNumber)}</td>
        <td>${esc(r.description)}</td>
        <td>${esc(r.location)}</td>
        <td class="num">${r.qtyNeeded}</td>
        <td>${esc(r.requestedBy)}</td>
        <td class="actions">${!CAN_ORDER ? "" : `
          <button class="btn primary sm" data-act="order" data-id="${r.id}">🛒 Order</button>
          <button class="btn danger sm" data-act="cancel" data-id="${r.id}" title="Cancel this request">✕</button>`}
        </td></tr>`;
    }
    const late = r.status === "ordered" && r.expectedDate && r.expectedDate < today;
    return `<tr${fl}>
      <td>${fmtDate(r.requestedAt)}</td>
      <td>${fmtDate(r.orderedAt)}</td>
      <td class="pn">${esc(r.partNumber)}</td>
      <td>${esc(r.description)}</td>
      <td class="num">${r.qtyOrdered ?? ""}</td>
      <td class="${late ? "late" : ""}">${fmtDate(r.expectedDate, false)}${late ? " (late)" : ""}</td>
      <td>${esc(r.poNumber)}</td>
      <td>${esc(r.vendor)}</td>
      <td>${esc(r.orderedBy)}<div class="sub">${esc(r.orderedByEmail)}</div></td>
      <td><span class="pill ${r.status}">${r.status === "received" ? "Received" : "Ordered"}</span>
          ${r.receivedAt ? `<div class="sub">${fmtDate(r.receivedAt)}</div>` : ""}</td>
      <td class="actions">${!CAN_ORDER ? "" : `
        <button class="btn sm" data-act="edit" data-id="${r.id}">Edit</button>
        ${r.status === "ordered" ? `<button class="btn success sm" data-act="receive" data-id="${r.id}">Received</button>` : ""}`}
      </td></tr>`;
  }).join("");
  $("#empty").classList.toggle("hidden", list.length > 0);
  state.flash.clear();
  const isOrd = state.tab === "ordered";
  $("#btnMore").classList.toggle("hidden", !(isOrd && state.orderedMore));
  $("#moreInfo").textContent = isOrd
    ? (state.orderedMode === "search" ? `${list.length} order(s) found for this part number` : `Showing ${list.length} order(s)${state.orderedMore ? " — more available" : ""}`)
    : "";
}

/* ---------------- Tabs & filters ---------------- */
$$(".tab").forEach(t => t.addEventListener("click", () => {
  $$(".tab").forEach(x => x.classList.toggle("active", x === t));
  state.tab = t.dataset.tab;
  $("#dateLabel").textContent = state.tab === "pending" ? "Requested" : "Ordered";
  $("#btnNew").classList.toggle("hidden", state.tab !== "pending" || !CAN_ORDER);
  if (state.tab === "ordered") loadOrdered(); else render();
}));
const refilter = () => (state.tab === "ordered" ? loadOrdered() : render());
let deb;
$("#fPn").addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(refilter, state.tab === "ordered" ? 600 : 150); });
$("#fStart").addEventListener("change", refilter);
$("#fEnd").addEventListener("change", refilter);
$("#btnClear").addEventListener("click", () => { $("#fPn").value = $("#fStart").value = $("#fEnd").value = ""; refilter(); });
$("#btnMore").addEventListener("click", () => loadOrdered(false));
if (!CAN_ORDER) $("#btnNew").classList.add("hidden");

$("#btnCsv").addEventListener("click", () => {
  const rows = visibleRows();
  const header = ["Part #", "Description", "Qty needed", "Requested", "Requested by", "Status", "Ordered", "Qty ordered",
    "When coming", "PO #", "Vendor", "Ordered by", "Ordered by email", "Received", "Notes"];
  downloadCSV(`${state.tab}-orders-${todayStr()}.csv`, header, rows.map(r => [
    r.partNumber, r.description, r.qtyNeeded, isoLocal(r.requestedAt), r.requestedBy, r.status, isoLocal(r.orderedAt),
    r.qtyOrdered ?? "", r.expectedDate || "", r.poNumber || "", r.vendor || "", r.orderedBy || "", r.orderedByEmail || "",
    isoLocal(r.receivedAt), r.notes || ""]));
});

/* ---------------- Row actions ---------------- */
const findRow = id => state.pending.find(x => x.id === id) || state.ordered.find(x => x.id === id);
$("#tbl").addEventListener("click", async e => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const r = findRow(b.dataset.id); if (!r) return;
  const act = b.dataset.act;
  if (act === "order") {
    if (r.orderUrl) window.open(r.orderUrl, "_blank", "noopener");
    openOrderDialog(r, true);
  } else if (act === "edit") {
    openOrderDialog(r, false);
  } else if (act === "cancel") {
    if (!confirm(`Cancel the request for ${r.partNumber}?`)) return;
    try {
      const bt = writeBatch(db);
      bt.update(doc(db, "requests", r.id), { status: "cancelled", cancelledAt: serverTimestamp(), cancelledBy: me.name });
      bt.delete(doc(db, "board", r.id));
      bt.update(doc(db, "parts", r.partId), { pendingRequestId: null, pendingSince: null });
      await bt.commit(); toast("Request cancelled");
    } catch (err) { toast(friendlyError(err), "err"); }
  } else if (act === "receive") {
    if (!confirm(`Mark ${r.partNumber} (PO ${r.poNumber || "-"}) as received?`)) return;
    try {
      const bt = writeBatch(db);
      bt.update(doc(db, "requests", r.id), { status: "received", receivedAt: serverTimestamp(), receivedBy: me.name });
      bt.set(doc(db, "board", r.id), { status: "received", receivedAt: serverTimestamp() }, { merge: true });
      await bt.commit();
      Object.assign(r, { status: "received", receivedAt: Timestamp.now(), receivedBy: me.name });
      render(); toast("Marked as received");
    } catch (err) { toast(friendlyError(err), "err"); }
  }
});

function openOrderDialog(r, isNew) {
  state.current = { row: r, isNew };
  $("#oTitle").textContent = isNew ? "Record order" : "Edit order";
  $("#oSub").textContent = `${r.partNumber} — ${r.description || ""} (requested ${fmtDate(r.requestedAt)})`;
  $("#oQty").value = r.qtyOrdered || r.qtyNeeded;
  $("#oPo").value = r.poNumber || "";
  $("#oVendor").value = r.vendor || r.partVendor || "";
  $("#oEta").value = r.expectedDate || "";
  $("#oNotes").value = r.notes || "";
  $("#oSave").textContent = isNew ? "Mark as ordered" : "Save changes";
  $("#oLinkHint").innerHTML = isNew
    ? (r.orderUrl ? `The order page opened in a new tab. <a href="${esc(r.orderUrl)}" target="_blank" rel="noopener">Open it again</a>. After you place the order there, fill in the details below.`
                  : "No order link is set for this part (admin can add one).")
    : "";
  $("#oErr").textContent = "";
  $("#orderDlg").showModal();
}
$("#oCancel").addEventListener("click", () => $("#orderDlg").close());
$("#orderForm").addEventListener("submit", async e => {
  e.preventDefault();
  const { row: r, isNew } = state.current;
  const qty = parseInt($("#oQty").value, 10);
  if (!qty || qty < 1) { $("#oErr").textContent = "Qty ordered must be at least 1"; return; }
  const f = { qtyOrdered: qty, poNumber: $("#oPo").value.trim(), vendor: $("#oVendor").value.trim(),
              expectedDate: $("#oEta").value || null, notes: $("#oNotes").value.trim() };
  try {
    const bt = writeBatch(db);
    if (isNew && r.status === "pending") {
      bt.update(doc(db, "requests", r.id), { ...f, status: "ordered", orderedAt: serverTimestamp(), orderedBy: me.name, orderedByEmail: me.email });
      bt.set(doc(db, "board", r.id), { status: "ordered", orderedAt: serverTimestamp(), expectedDate: f.expectedDate, qty }, { merge: true });
      bt.update(doc(db, "parts", r.partId), { pendingRequestId: null, pendingSince: null });
    } else {
      bt.update(doc(db, "requests", r.id), f);
      bt.set(doc(db, "board", r.id), { expectedDate: f.expectedDate, qty }, { merge: true });
    }
    await bt.commit();
    $("#orderDlg").close();
    if (!isNew) { Object.assign(r, f); render(); }
    toast(isNew ? `${r.partNumber} marked as ordered` : "Order updated");
  } catch (err) { $("#oErr").textContent = friendlyError(err); }
});

/* ---------------- Manual new request ---------------- */
$("#btnNew").addEventListener("click", async () => {
  try {
    if (!state.parts) {   // loaded once per page visit
      const snap = await getDocs(query(collection(db, "parts"), where("active", "==", true)));
      state.parts = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.partNumber.localeCompare(b.partNumber));
    }
  } catch (err) { toast(friendlyError(err), "err"); return; }
  $("#nPart").innerHTML = state.parts.map(p => `<option value="${p.id}">${esc(p.partNumber)} — ${esc(p.description)}</option>`).join("");
  const sync = () => { const p = state.parts.find(x => x.id === $("#nPart").value); $("#nQty").value = p ? p.orderQty : 1; };
  $("#nPart").onchange = sync; sync();
  $("#nErr").textContent = state.parts.length ? "" : "No parts are set up yet (Admin page).";
  $("#newDlg").showModal();
});
$("#nCancel").addEventListener("click", () => $("#newDlg").close());
$("#newForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    const r = await createRequest($("#nPart").value, { by: me.name, byEmail: me.email, source: "web", qty: parseInt($("#nQty").value, 10) });
    if (r.result === "duplicate") { $("#nErr").textContent = `${r.part.partNumber} already has a pending request (since ${fmtDate(r.part.pendingSince)}).`; return; }
    $("#newDlg").close(); toast("Request added");
  } catch (err) { $("#nErr").textContent = friendlyError(err); }
});

setupSoundBanner();
render();
