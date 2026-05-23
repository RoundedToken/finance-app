// Mini App — D1-centric. All CRUD via Worker REST API.
// No localStorage outbox: D1 = single source of truth.

const tg = window.Telegram?.WebApp;
const WORKER_BASE = "https://finances-worker.stepan-mikhalev-99.workers.dev";

// ───────────── state
const state = {
    accounts: [],
    categories: [],         // expense только
    allCategories: [],      // включая income/system (для edit dropdown)
    currencies: [],
    expenses: [],           // полный список из D1 (last 500)
    bootstrapped: false,
    bootstrapError: null,

    amount: "0",
    currency: "RSD",
    date: todayISO(),
    note: "",
    catPage: 0,
    catsPerPage: 8,

    editingId: null,
    editingCategory: null,
};

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

// ───────────── network
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
        state.expenses = data.expenses || [];
        state.bootstrapped = true;
        state.bootstrapError = null;
    } catch (e) {
        state.bootstrapError = String(e.message || e);
    }
}

async function postExpense(e) { return await api("/v1/expenses", { method: "POST", body: JSON.stringify(e) }); }
async function putExpense(id, patch) { return await api(`/v1/expenses/${id}`, { method: "PUT", body: JSON.stringify(patch) }); }
async function delExpense(id) { return await api(`/v1/expenses/${id}`, { method: "DELETE" }); }

// ───────────── DOM
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

// ───────────── helpers
function flagOf(code) { return state.currencies.find(c => c.code === code)?.emoji || "💱"; }
function catOf(id) { return state.allCategories.find(c => c.id === id); }
function fmt(n) {
    if (n === Math.floor(n)) return n.toLocaleString("ru-RU");
    return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}
function humanDayTitle(iso) {
    const today = todayISO();
    const yest = dateShift(-1);
    const d = new Date(iso + "T00:00:00");
    const weekdays = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
    const monthsGen = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
    let prefix = "";
    if (iso === today) prefix = "Сегодня";
    else if (iso === yest) prefix = "Вчера";
    else prefix = `${d.getDate()} ${monthsGen[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""}`;
    const wd = weekdays[d.getDay()];
    return { prefix, weekday: wd };
}
function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
}

// ───────────── render
function render() {
    renderDisplay();
    renderSideActions();
    renderCategories();
    renderRecentDays();
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
    $("#side-date").textContent = state.date === today ? "сегодня"
                               : state.date === dateShift(-1) ? "вчера"
                               : state.date.slice(5);
    $("#side-note-indicator").textContent = state.note ? "есть" : "описание";
    $("#open-note").classList.toggle("has-note", !!state.note);
}

function renderCategories() {
    const grid = $("#categories-grid");
    const pager = $("#categories-pager");
    grid.innerHTML = "";
    pager.innerHTML = "";

    if (!state.bootstrapped) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--hint);padding:18px;font-size:12px;">
            ${state.bootstrapError ? "Ошибка: " + escapeHtml(state.bootstrapError) : "Загрузка категорий…"}
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
        btn.innerHTML = `<span class="emoji">${cat.emoji || "📌"}</span><span class="name">${escapeHtml(cat.name)}</span>`;
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

// Сегодня + вчера групированно
function renderRecentDays() {
    const container = $("#recent-days");
    container.innerHTML = "";
    const today = todayISO();
    const yest = dateShift(-1);
    for (const day of [today, yest]) {
        const block = buildDayGroup(day, /* showEmpty= */ true);
        container.appendChild(block);
    }
}

function buildDayGroup(day, showEmpty) {
    const items = state.expenses.filter(e => e.date === day);
    const block = document.createElement("div");
    block.className = "day-group";

    const sums = new Map();
    for (const e of items) sums.set(e.currency, (sums.get(e.currency) || 0) + e.amount);
    const totalLabel = sums.size === 0
        ? (showEmpty ? "— нет операций" : "")
        : [...sums.entries()].map(([c, n]) => `${fmt(n)} ${flagOf(c)} ${c}`).join(" + ");

    const titleData = humanDayTitle(day);
    const head = document.createElement("div");
    head.className = "day-head";
    head.innerHTML = `
        <span class="day-title">${escapeHtml(titleData.prefix)}<small>${escapeHtml(titleData.weekday)}</small></span>
        <span class="day-total">${totalLabel}</span>
    `;
    block.appendChild(head);

    if (items.length || !showEmpty) {
        const ul = document.createElement("ul");
        ul.className = "day-rows";
        for (const e of items) ul.appendChild(buildExpenseRow(e));
        block.appendChild(ul);
    }
    return block;
}

function buildExpenseRow(e) {
    const cat = catOf(e.category_id);
    const li = document.createElement("li");
    li.className = "day-row";
    const noteHtml = e.note ? `<div class="note">${escapeHtml(e.note)}</div>` : "";
    li.innerHTML = `
        <span class="icon" style="background:${cat?.color || "var(--bg-elevated)"}">${cat?.emoji || "📌"}</span>
        <div class="body">
            <div class="name">${escapeHtml(cat?.name || "—")}</div>
            ${noteHtml}
        </div>
        <span class="amount"><span class="flag">${flagOf(e.currency)}</span>${fmt(e.amount)} ${e.currency}</span>
    `;
    li.addEventListener("click", () => openEditModal(e));
    return li;
}

function renderHistoryScreen() {
    const list = $("#history-list");
    list.innerHTML = "";
    if (!state.expenses.length) {
        list.innerHTML = `<p class="history-hint">Пока пусто.</p>`;
        return;
    }
    const groupedByDate = new Map();
    for (const e of state.expenses) {
        if (!groupedByDate.has(e.date)) groupedByDate.set(e.date, []);
        groupedByDate.get(e.date).push(e);
    }
    const dates = [...groupedByDate.keys()].sort((a, b) => a < b ? 1 : -1);
    for (const d of dates) {
        // Подменим логику чтобы использовать готовые рендеры:
        const block = document.createElement("div");
        block.className = "day-group";

        const items = groupedByDate.get(d);
        const sums = new Map();
        for (const e of items) sums.set(e.currency, (sums.get(e.currency) || 0) + e.amount);
        const totalLabel = [...sums.entries()].map(([c, n]) => `${fmt(n)} ${flagOf(c)} ${c}`).join(" + ");
        const t = humanDayTitle(d);
        const head = document.createElement("div");
        head.className = "day-head";
        head.innerHTML = `
            <span class="day-title">${escapeHtml(t.prefix)}<small>${escapeHtml(t.weekday)}</small></span>
            <span class="day-total">${totalLabel}</span>
        `;
        block.appendChild(head);
        const ul = document.createElement("ul");
        ul.className = "day-rows";
        for (const e of items) ul.appendChild(buildExpenseRow(e));
        block.appendChild(ul);
        list.appendChild(block);
    }
}

// ───────────── currency picker
function renderCurrencyPicker() {
    const grid = $("#currency-grid");
    grid.innerHTML = "";
    for (const c of state.currencies) {
        const btn = document.createElement("button");
        btn.className = c.code === state.currency ? "active" : "";
        btn.innerHTML = `<span class="ccy-flag">${c.emoji || "💱"}</span>
                         <span class="ccy-code">${c.code}</span>
                         <span class="ccy-name">${escapeHtml(c.name)}</span>`;
        btn.addEventListener("click", () => {
            state.currency = c.code;
            renderDisplay();
            renderSideActions();
            closeModals();
        });
        grid.appendChild(btn);
    }
}

// ───────────── edit modal
function openEditModal(expense) {
    state.editingId = expense.id;
    state.editingCategory = expense.category_id;
    $("#edit-amount").value = expense.amount;
    $("#edit-date").value = expense.date;
    $("#edit-note").value = expense.note || "";

    const sel = $("#edit-currency");
    sel.innerHTML = "";
    for (const c of state.currencies) {
        const o = document.createElement("option");
        o.value = c.code;
        o.textContent = `${c.emoji || ""} ${c.code} · ${c.name}`;
        if (c.code === expense.currency) o.selected = true;
        sel.appendChild(o);
    }

    const catGrid = $("#edit-cat-grid");
    catGrid.innerHTML = "";
    for (const c of state.categories) {
        const b = document.createElement("button");
        b.className = c.id === expense.category_id ? "active" : "";
        b.style.background = c.color || "var(--bg)";
        b.textContent = c.emoji || "📌";
        b.title = c.name;
        b.dataset.id = c.id;
        b.addEventListener("click", () => {
            state.editingCategory = c.id;
            $$(".cat-mini-grid button.active").forEach(x => x.classList.remove("active"));
            b.classList.add("active");
        });
        catGrid.appendChild(b);
    }

    openModal("edit");
}

async function saveEdit() {
    const id = state.editingId;
    const patch = {
        amount: parseFloat($("#edit-amount").value),
        currency: $("#edit-currency").value,
        date: $("#edit-date").value,
        note: $("#edit-note").value.trim() || null,
        category_id: state.editingCategory || null,
    };
    if (!(patch.amount > 0)) { toast("Сумма?", "err"); return; }

    try {
        await putExpense(id, patch);
        // обновляем локальный state
        const idx = state.expenses.findIndex(e => e.id === id);
        if (idx >= 0) state.expenses[idx] = { ...state.expenses[idx], ...patch, updated_at: new Date().toISOString() };
        render();
        if (!$("#screen-history").hidden) renderHistoryScreen();
        closeModals();
        toast("✓ Сохранено", "ok");
    } catch (e) {
        toast("Ошибка: " + e.message, "err");
    }
}

async function deleteEntry() {
    const id = state.editingId;
    try {
        await delExpense(id);
        state.expenses = state.expenses.filter(e => e.id !== id);
        render();
        if (!$("#screen-history").hidden) renderHistoryScreen();
        closeModals();
        toast("🗑️ Удалено", "ok");
    } catch (e) {
        toast("Ошибка: " + e.message, "err");
    }
}

// ───────────── input handlers
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
        source: "mini_app",
        created_at: new Date().toISOString(),
    };
    // Optimistic — добавим в state, потом подтверждение от API
    state.expenses.unshift(expense);
    render();

    try {
        await postExpense(expense);
        toast(`✓ ${fmt(amount)} ${state.currency} → ${cat.name}`, "ok");
        state.amount = "0";
        state.note = "";
        renderDisplay();
        renderSideActions();
        renderCategories();
    } catch (e) {
        state.expenses = state.expenses.filter(x => x.id !== expense.id);
        render();
        toast("Ошибка: " + e.message, "err");
    }
}

// ───────────── init
function bindEvents() {
    $$("#numpad button").forEach(b => b.addEventListener("click", () => onNumpadTap(b)));

    $("#open-history").addEventListener("click", () => { renderHistoryScreen(); showScreen("history"); });
    $("#open-currency").addEventListener("click", () => { renderCurrencyPicker(); openModal("currency"); });
    $("#open-date").addEventListener("click", () => { $("#date-input").value = state.date; openModal("date"); });
    $("#open-note").addEventListener("click", () => { $("#note-input").value = state.note; openModal("note"); });

    $$("[data-close]").forEach(el => el.addEventListener("click", closeModals));
    $$("[data-back]").forEach(el => el.addEventListener("click", () => showScreen("main")));
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

    // Swipe для пагинации категорий
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
        try { tg.disableVerticalSwipes?.(); } catch {}
        try { tg.setHeaderColor?.("#2b2546"); } catch {}
        try { tg.setBackgroundColor?.("#2b2546"); } catch {}
    }
    bindEvents();
    render();

    await bootstrap();
    const def = state.accounts.find(a => a.type !== "external")?.currency || "RSD";
    state.currency = def;
    render();
}

init();
