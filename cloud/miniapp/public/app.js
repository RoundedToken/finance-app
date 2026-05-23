// Mini App. Personal finance tracker.
// Архитектура: state-machine, vanilla JS, без фреймворков.

const tg = window.Telegram?.WebApp;
const WORKER_BASE = "https://finances-worker.<owner>.workers.dev";
const STORE_KEY = "finances.miniapp.v3";

// ───────────────────────────── state
const state = {
    accounts: [],
    categories: [],         // expense только
    allCategories: [],      // включая income/system (для edit)
    currencies: [],
    recentExpenses: [],     // из D1 cache, read-only история
    bootstrapped: false,
    bootstrapError: null,

    amount: "0",
    currency: "RSD",
    date: todayISO(),
    note: "",
    catPage: 0,
    catsPerPage: 8,

    sent: loadLocal().sent || [], // что отправили с этого устройства, может быть edited
    editingId: null,              // id записи в режиме редактирования
};

function loadLocal() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; }
}
function saveLocal() {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sent: state.sent.slice(-300) }));
}

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}
function dateShift(days) {
    const d = new Date(); d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}
function uuid4() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
}

// ───────────────────────────── network
async function api(path, options = {}) {
    const headers = {
        "Content-Type": "application/json",
        ...(tg?.initData ? { "X-Telegram-Init-Data": tg.initData } : {}),
        ...(options.headers || {}),
    };
    const r = await fetch(WORKER_BASE + path, { ...options, headers });
    if (!r.ok) {
        const t = await r.text().catch(() => r.statusText);
        throw new Error(`${r.status} ${t.slice(0, 200)}`);
    }
    return r.json();
}

async function bootstrap() {
    try {
        const data = await api("/v1/bootstrap");
        state.allCategories = data.categories || [];
        state.categories = state.allCategories.filter(c => c.type === "expense");
        state.accounts = data.accounts || [];
        state.currencies = data.currencies || [];
        state.recentExpenses = data.recent_expenses || [];
        state.bootstrapped = true;
        state.bootstrapError = null;
    } catch (e) {
        state.bootstrapError = String(e.message || e);
    }
}

async function postExpense(e) {
    return await api("/v1/expenses", { method: "POST", body: JSON.stringify(e) });
}

// ───────────────────────────── DOM helpers
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
function showScreen(name) {
    $$(".screen").forEach(s => s.hidden = true);
    const t = $(`#screen-${name}`); if (t) t.hidden = false;
    $("#app").scrollTop = 0;
}
function openModal(name) { $(`#modal-${name}`).hidden = false; }
function closeModals() { $$(".modal").forEach(m => m.hidden = true); }
function toast(msg, kind = "ok") {
    const el = $("#toast");
    el.textContent = msg;
    el.className = `toast ${kind} show`;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2000);
}

// ───────────────────────────── rendering
function flagOf(code) {
    return state.currencies.find(c => c.code === code)?.emoji || "💱";
}
function catOf(id) {
    return state.allCategories.find(c => c.id === id);
}
function fmt(n) {
    if (n === Math.floor(n)) return n.toLocaleString("ru-RU");
    return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function render() {
    renderDisplay();
    renderSideActions();
    renderCategories();
    renderFooter();
}

function renderDisplay() {
    const a = $("#amount-display");
    a.textContent = state.amount;
    a.classList.toggle("empty", state.amount === "0");
    $("#currency-display").textContent = state.currency;
    $("#display-flag").textContent = flagOf(state.currency);
}

function renderSideActions() {
    $("#side-currency").textContent = state.currency;
    $("#side-flag").textContent = flagOf(state.currency);
    const today = todayISO();
    const lbl = state.date === today ? "сегодня"
              : state.date === dateShift(-1) ? "вчера"
              : state.date.slice(5);
    $("#side-date").textContent = lbl;
    const noteBtn = $("#open-note");
    $("#side-note-indicator").textContent = state.note ? "есть" : "заметка";
    noteBtn.classList.toggle("has-note", !!state.note);
}

function renderCategories() {
    const grid = $("#categories-grid");
    const pager = $("#categories-pager");
    grid.innerHTML = "";
    pager.innerHTML = "";

    if (!state.bootstrapped) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--hint);padding:18px;font-size:12px;">
            ${state.bootstrapError ? "Ошибка: " + state.bootstrapError : "Загрузка категорий…"}
        </div>`;
        return;
    }

    const cats = state.categories;
    const totalPages = Math.max(1, Math.ceil(cats.length / state.catsPerPage));
    if (state.catPage >= totalPages) state.catPage = 0;
    const start = state.catPage * state.catsPerPage;
    const slice = cats.slice(start, start + state.catsPerPage);
    const amountValid = parseFloat(state.amount) > 0;

    for (const cat of slice) {
        const btn = document.createElement("button");
        btn.className = "cat" + (amountValid ? "" : " disabled");
        btn.style.background = cat.color || "var(--bg-elevated)";
        btn.innerHTML = `<span class="emoji">${cat.emoji || "📌"}</span><span class="name">${cat.name}</span>`;
        btn.addEventListener("click", () => onCategoryTap(cat));
        grid.appendChild(btn);
    }
    for (let i = 0; i < totalPages; i++) {
        const dot = document.createElement("span");
        dot.className = "dot" + (i === state.catPage ? " active" : "");
        dot.addEventListener("click", () => { state.catPage = i; renderCategories(); });
        pager.appendChild(dot);
    }
}

function renderFooter() {
    const today = todayISO();
    const yest = dateShift(-1);
    // Берём из union: sent + recentExpenses, дедуплицируем по id, тогда новые из Mini App
    // и старые из импорта обе вилимы.
    const allByDate = (d) => {
        const map = new Map();
        for (const e of state.sent.filter(x => x.date === d && x.ok)) map.set(e.id, e);
        for (const e of state.recentExpenses.filter(x => x.date === d)) {
            if (!map.has(e.id)) map.set(e.id, e);
        }
        return [...map.values()];
    };
    const sumBy = (list) => {
        const m = new Map();
        for (const e of list) m.set(e.currency, (m.get(e.currency) || 0) + e.amount);
        return m;
    };
    const ccyStr = (m) => m.size === 0 ? "—" :
        [...m.entries()].map(([c, n]) => `${fmt(n)} ${c}`).join(" + ");
    $("#spent-today").textContent = ccyStr(sumBy(allByDate(today)));
    $("#spent-yesterday").textContent = ccyStr(sumBy(allByDate(yest)));

    const list = $("#recent-list");
    list.innerHTML = "";
    // Последние 8 из sent ∪ recent
    const map = new Map();
    for (const e of [...state.recentExpenses, ...state.sent.filter(x => x.ok)]) {
        map.set(e.id, e);
    }
    const all = [...map.values()].sort((a, b) => (b.created_at || b.date) < (a.created_at || a.date) ? -1 : 1);
    for (const e of all.slice(0, 8)) {
        const cat = catOf(e.category_id);
        const li = document.createElement("li");
        li.innerHTML = `
            <span class="icon" style="background:${cat?.color || "var(--bg-elevated)"}">${cat?.emoji || "📌"}</span>
            <span class="name">${cat?.name || e.category_id || "—"}</span>
            <span class="amount">${fmt(e.amount)} ${e.currency}</span>
        `;
        // tap → edit (только для своих)
        const ownEntry = state.sent.find(s => s.id === e.id);
        if (ownEntry) {
            li.addEventListener("click", () => openEditModal(ownEntry, /*owned*/ true));
        } else {
            li.addEventListener("click", () => openEditModal(e, /*owned*/ false));
        }
        list.appendChild(li);
    }
}

function renderHistoryScreen() {
    const list = $("#history-list");
    list.innerHTML = "";

    // union sent + recent, по date desc
    const map = new Map();
    for (const e of state.recentExpenses) map.set(e.id, e);
    for (const e of state.sent.filter(x => x.ok)) map.set(e.id, e);
    const all = [...map.values()]
        .filter(e => e.deleted_at == null)
        .sort((a, b) => (a.date < b.date ? 1 : -1));

    if (!all.length) {
        list.innerHTML = `<p class="history-hint">Пока нет ни одной траты.</p>`;
        return;
    }

    let curDay = null;
    for (const e of all) {
        if (e.date !== curDay) {
            curDay = e.date;
            const h = document.createElement("div");
            h.className = "day-head";
            h.textContent = humanDate(e.date);
            list.appendChild(h);
        }
        const cat = catOf(e.category_id);
        const row = document.createElement("div");
        row.className = "history-row";
        row.innerHTML = `
            <span class="icon" style="background:${cat?.color || "var(--bg-elevated)"}">${cat?.emoji || "📌"}</span>
            <span class="name">${cat?.name || "—"}${e.note ? `<small>${escapeHtml(e.note)}</small>` : ""}</span>
            <span class="amount">${fmt(e.amount)} ${e.currency}</span>
        `;
        const ownEntry = state.sent.find(s => s.id === e.id);
        row.addEventListener("click", () => openEditModal(ownEntry || e, !!ownEntry));
        list.appendChild(row);
    }
}

function renderSyncScreen() {
    const body = $("#sync-body");
    const ownCount = state.sent.filter(s => s.ok).length;
    const pendingCount = state.sent.filter(s => !s.ok && !s.error).length;
    const errorCount = state.sent.filter(s => s.error).length;
    const totalCached = state.recentExpenses.length;
    const last = state.sent[state.sent.length - 1];

    body.innerHTML = `
        <div class="info-row">
            <span class="label">В кеше Mini App</span>
            <b>${totalCached}</b> записей (загружено при старте)
        </div>
        <div class="info-row">
            <span class="label">Отправлено с этого устройства</span>
            <b>${ownCount}</b> ✓ &nbsp; ${pendingCount} в очереди &nbsp; ${errorCount} ошибок
        </div>
        ${last ? `
        <div class="info-row">
            <span class="label">Последняя</span>
            ${fmt(last.amount)} ${last.currency} · ${last.sent_at?.slice(0,16).replace("T"," ") || ""}
        </div>` : ""}
        <div class="info-row">
            <span class="label">MacBook</span>
            Статус MacBook — через бота: команда <b>/sync</b>.<br>
            <span style="color:var(--hint);">MacBook опрашивает облако каждую минуту, если открыт.</span>
        </div>
    `;
}

function humanDate(iso) {
    if (iso === todayISO()) return "Сегодня";
    if (iso === dateShift(-1)) return "Вчера";
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}
function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
}

// ───────────────────────────── currency picker
function renderCurrencyPicker() {
    const grid = $("#currency-grid");
    grid.innerHTML = "";
    for (const c of state.currencies) {
        const btn = document.createElement("button");
        btn.className = c.code === state.currency ? "active" : "";
        btn.innerHTML = `<span class="ccy-flag">${c.emoji || "💱"}</span>
                         <span class="ccy-code">${c.code}</span>
                         <span class="ccy-name">${c.name}</span>`;
        btn.addEventListener("click", () => {
            state.currency = c.code;
            renderDisplay();
            renderSideActions();
            closeModals();
        });
        grid.appendChild(btn);
    }
}

// ───────────────────────────── edit modal
function openEditModal(expense, owned) {
    state.editingId = expense.id;
    $("#edit-title").textContent = owned ? "Редактировать" : "Просмотр";

    $("#edit-amount").value = expense.amount;
    $("#edit-amount").disabled = !owned;
    $("#edit-date").value = expense.date;
    $("#edit-date").disabled = !owned;
    $("#edit-note").value = expense.note || "";
    $("#edit-note").disabled = !owned;

    const sel = $("#edit-currency");
    sel.innerHTML = "";
    for (const c of state.currencies) {
        const o = document.createElement("option");
        o.value = c.code;
        o.textContent = `${c.emoji || ""} ${c.code} · ${c.name}`;
        if (c.code === expense.currency) o.selected = true;
        sel.appendChild(o);
    }
    sel.disabled = !owned;

    const catGrid = $("#edit-cat-grid");
    catGrid.innerHTML = "";
    for (const c of state.categories) {
        const b = document.createElement("button");
        b.className = c.id === expense.category_id ? "active" : "";
        b.style.background = c.color || "var(--bg)";
        b.textContent = c.emoji || "📌";
        b.title = c.name;
        b.disabled = !owned;
        b.addEventListener("click", () => {
            $$(".cat-mini-grid button.active").forEach(x => x.classList.remove("active"));
            b.classList.add("active");
            b.dataset.selected = "1";
            catGrid.dataset.value = c.id;
        });
        if (c.id === expense.category_id) catGrid.dataset.value = c.id;
        catGrid.appendChild(b);
    }

    $("#edit-save").style.display = owned ? "" : "none";
    $("#edit-delete").style.display = owned ? "" : "none";
    $("#edit-note-readonly").hidden = owned;

    openModal("edit");
}

async function saveEdit() {
    const id = state.editingId;
    const ownEntry = state.sent.find(s => s.id === id);
    if (!ownEntry) { toast("Нельзя редактировать", "err"); return; }

    const newExpense = {
        id,
        amount: parseFloat($("#edit-amount").value),
        currency: $("#edit-currency").value,
        date: $("#edit-date").value,
        note: $("#edit-note").value.trim() || null,
        category_id: $("#edit-cat-grid").dataset.value || ownEntry.category_id,
        created_at: ownEntry.created_at,
    };
    if (!(newExpense.amount > 0)) { toast("Сумма?", "err"); return; }

    // Локально обновляем optimistically
    Object.assign(ownEntry, newExpense, { ok: false });
    saveLocal(); renderFooter();

    try {
        // Тот же UUID → Worker INSERT OR IGNORE → не обновит outbox
        // Но Mini App кеш у нас локальный, поэтому считаем что обновили.
        // Полноценный edit (обновление на MacBook) — Stage 5.
        // Сейчас просто помечаем локально + отправляем как новую запись (если есть смысл).
        ownEntry.ok = true;
        ownEntry.edited_locally_at = new Date().toISOString();
        saveLocal();
        renderFooter();
        renderHistoryScreen();
        toast("✓ Сохранено локально", "ok");
        closeModals();
    } catch (e) {
        toast("Ошибка: " + e.message, "err");
    }
}

function deleteEntry() {
    const id = state.editingId;
    const ownEntry = state.sent.find(s => s.id === id);
    if (!ownEntry) return;
    ownEntry.deleted_at = new Date().toISOString();
    saveLocal();
    renderFooter();
    renderHistoryScreen();
    toast("🗑️ Удалено локально", "ok");
    closeModals();
}

// ───────────────────────────── interactions
function onNumpadTap(button) {
    const key = button.dataset.key;
    if (key === "back") {
        state.amount = state.amount.length > 1 ? state.amount.slice(0, -1) : "0";
    } else if (key === "dot") {
        if (!state.amount.includes(".")) state.amount += ".";
    } else {
        const ch = button.textContent.trim();
        const [intPart, fracPart] = state.amount.split(".");
        if (fracPart !== undefined && fracPart.length >= 2) return;
        if (state.amount.length >= 12) return;
        state.amount = state.amount === "0" ? ch : state.amount + ch;
    }
    tg?.HapticFeedback?.selectionChanged?.();
    renderDisplay();
    renderCategories();
}

async function onCategoryTap(cat) {
    const amount = parseFloat(state.amount);
    if (!(amount > 0)) { toast("Введите сумму", "err"); return; }
    tg?.HapticFeedback?.impactOccurred?.("light");

    const expense = {
        id: uuid4(),
        date: state.date,
        amount,
        currency: state.currency,
        category_id: cat.id,
        note: state.note || null,
        created_at: new Date().toISOString(),
    };
    const local = { ...expense, ok: false, sent_at: expense.created_at };
    state.sent.push(local);
    saveLocal();
    renderFooter();

    try {
        await postExpense(expense);
        local.ok = true;
        saveLocal();
        renderFooter();
        toast(`✓ ${fmt(amount)} ${state.currency} → ${cat.name}`, "ok");
        state.amount = "0";
        state.note = "";
        renderDisplay();
        renderSideActions();
        renderCategories();
    } catch (e) {
        local.error = String(e.message || e);
        saveLocal();
        renderFooter();
        toast("Ошибка: " + e.message, "err");
    }
}

// ───────────────────────────── init
function bindEvents() {
    $$("#numpad button").forEach(b => b.addEventListener("click", () => onNumpadTap(b)));

    $("#open-menu").addEventListener("click", () => openModal("menu"));
    $("#open-currency").addEventListener("click", () => { renderCurrencyPicker(); openModal("currency"); });
    $("#open-date").addEventListener("click", () => { $("#date-input").value = state.date; openModal("date"); });
    $("#open-note").addEventListener("click", () => { $("#note-input").value = state.note; openModal("note"); });
    $("#open-sync").addEventListener("click", () => { showScreen("sync"); renderSyncScreen(); });

    $$("[data-close]").forEach(el => el.addEventListener("click", closeModals));
    $$("[data-back]").forEach(el => el.addEventListener("click", () => showScreen("main")));
    $$("[data-go]").forEach(el => el.addEventListener("click", () => {
        closeModals();
        const t = el.dataset.go;
        if (t === "history") { renderHistoryScreen(); showScreen("history"); }
        else if (t === "sync") { renderSyncScreen(); showScreen("sync"); }
    }));

    $$("[data-date-shift]").forEach(el => el.addEventListener("click", () => {
        state.date = dateShift(parseInt(el.dataset.dateShift, 10));
        renderSideActions();
        closeModals();
    }));
    $("#date-input").addEventListener("change", e => {
        if (e.target.value) state.date = e.target.value;
        renderSideActions();
    });

    $("#note-save").addEventListener("click", () => { state.note = $("#note-input").value.trim(); renderSideActions(); closeModals(); });
    $("#note-clear").addEventListener("click", () => { $("#note-input").value = ""; state.note = ""; renderSideActions(); closeModals(); });

    $("#edit-save").addEventListener("click", saveEdit);
    $("#edit-delete").addEventListener("click", deleteEntry);

    // swipe для пагинации категорий
    const cats = $(".categories");
    let touchX = 0;
    cats.addEventListener("touchstart", e => { touchX = e.touches[0].clientX; }, { passive: true });
    cats.addEventListener("touchend", e => {
        const dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 40) {
            const total = Math.max(1, Math.ceil(state.categories.length / state.catsPerPage));
            state.catPage = (state.catPage + (dx < 0 ? 1 : -1) + total) % total;
            renderCategories();
        }
    }, { passive: true });
}

async function init() {
    if (tg) {
        tg.ready();
        tg.expand();
        // Telegram WebApp 7.7+: блокирует пуллируемый swipe-to-close.
        try { tg.disableVerticalSwipes?.(); } catch {}
        // Применяем тему Telegram к header/bg.
        try { tg.setHeaderColor?.("#2b2546"); } catch {}
        try { tg.setBackgroundColor?.("#2b2546"); } catch {}
    }

    bindEvents();
    render();

    await bootstrap();
    // Дефолтная валюта — из первого "реального" аккаунта.
    const def = state.accounts.find(a => a.type !== "external")?.currency || "RSD";
    state.currency = def;
    render();
}

init();
