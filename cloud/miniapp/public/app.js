// Mini App — личный финансовый трекер.
// Архитектура: state-machine + DOM-first рендеринг. Без фреймворка.
// Все network — через initData (Telegram auth) + Bearer (для будущих admin endpoints).

const tg = window.Telegram?.WebApp;
const WORKER_URL = ""; // тот же origin (Worker)? Нет — Pages раздаёт Mini App, Worker отдельно
// Мы хостимся на Pages, Worker на workers.dev — нужно знать URL Worker'а:
const WORKER_BASE = "https://finances-worker.<owner>.workers.dev";

const STORE_KEY = "finances.miniapp.v1";

// ───────────────────────────────────────────────────────────── state
const state = {
    accounts: [],
    categories: [],
    currencies: [],
    bootstrapped: false,
    bootstrapError: null,

    amount: "0",
    currency: "RSD",
    date: todayISO(),
    note: "",
    catPage: 0,
    catsPerPage: 8,

    sentExpenses: loadLocal().sent || [], // {id, date, amount, currency, category_id, note, sent_at, ok, error}
};

function loadLocal() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; }
}
function saveLocal() {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sent: state.sentExpenses.slice(-200) }));
}

function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
}
function dateShift(daysFromToday) {
    const d = new Date();
    d.setDate(d.getDate() + daysFromToday);
    return d.toISOString().slice(0, 10);
}
function uuid4() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
}

// ───────────────────────────────────────────────────────────── network
async function api(path, options = {}) {
    const headers = {
        "Content-Type": "application/json",
        ...(tg?.initData ? { "X-Telegram-Init-Data": tg.initData } : {}),
        ...(options.headers || {}),
    };
    const r = await fetch(WORKER_BASE + path, { ...options, headers });
    if (!r.ok) {
        const text = await r.text().catch(() => r.statusText);
        throw new Error(`${r.status} ${text}`);
    }
    return r.json();
}

async function bootstrap() {
    try {
        const data = await api("/v1/bootstrap");
        state.accounts = data.accounts || [];
        state.categories = (data.categories || []).filter(c => c.type === "expense");
        state.currencies = data.currencies || [];
        state.bootstrapped = true;
        state.bootstrapError = null;
    } catch (e) {
        state.bootstrapError = String(e.message || e);
    }
}

async function fetchSyncStatus() {
    // Можем дёргать /v1/sync/status, но он требует Bearer. Из Mini App не положим.
    // Альтернатива: новый endpoint /v1/sync/status-public (initData auth). Сделаем
    // когда понадобится. Пока — показываем что есть только в localStorage.
    return null;
}

async function postExpense(expense) {
    const r = await api("/v1/expenses", {
        method: "POST",
        body: JSON.stringify(expense),
    });
    return r;
}

// ───────────────────────────────────────────────────────────── DOM helpers
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
function showScreen(name) {
    $$(".screen").forEach(s => s.hidden = true);
    const target = $(`#screen-${name}`);
    if (target) target.hidden = false;
}
function showModal(name) {
    $(`#modal-${name}`).hidden = false;
}
function closeModals() {
    $$(".modal").forEach(m => m.hidden = true);
}
function toast(msg, kind = "ok") {
    const el = $("#toast");
    el.textContent = msg;
    el.className = `toast ${kind} show`;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2200);
}

// ───────────────────────────────────────────────────────────── rendering
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
}

function renderSideActions() {
    $("#side-currency").textContent = state.currency;
    const today = todayISO();
    const sideDate = $("#side-date");
    if (state.date === today) sideDate.textContent = "сегодня";
    else if (state.date === dateShift(-1)) sideDate.textContent = "вчера";
    else sideDate.textContent = state.date.slice(5); // MM-DD
    $("#side-note-indicator").textContent = state.note ? "✓" : "";
    $("#open-note").classList.toggle("note-active", !!state.note);
}

function renderCategories() {
    const grid = $("#categories-grid");
    const pager = $("#categories-pager");
    grid.innerHTML = "";
    pager.innerHTML = "";

    if (!state.bootstrapped) {
        grid.innerHTML = `<div class="hint" style="grid-column: 1 / -1; text-align: center; color: var(--hint); padding: 24px;">
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
        btn.innerHTML = `<span class="emoji">${cat.emoji || "📌"}</span><span class="name">${cat.name}</span>`;
        btn.addEventListener("click", () => onCategoryTap(cat));
        grid.appendChild(btn);
    }
    while (slice.length && slice.length < state.catsPerPage) {
        const stub = document.createElement("span"); grid.appendChild(stub); break;
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
    const sumOn = (date) => state.sentExpenses
        .filter(e => e.date === date && e.ok)
        .reduce((acc, e) => acc + e.amount, 0);
    const totalToday = sumOn(today);
    const totalYest = sumOn(yest);
    const showAmount = (n, ccy) => n > 0 ? `${formatAmount(n)} ${ccy || ""}` : "—";

    // Группируем по валюте — для простоты показываем суммой по основной валюте состояния
    const todayByCcy = sumByCurrency(state.sentExpenses.filter(e => e.date === today && e.ok));
    const yestByCcy = sumByCurrency(state.sentExpenses.filter(e => e.date === yest && e.ok));
    $("#spent-today").textContent = formatMultiCcy(todayByCcy);
    $("#spent-yesterday").textContent = formatMultiCcy(yestByCcy);

    const list = $("#recent-list");
    list.innerHTML = "";
    const recent = state.sentExpenses.slice(-10).reverse();
    for (const e of recent) {
        const cat = state.categories.find(c => c.id === e.category_id);
        const li = document.createElement("li");
        li.innerHTML = `
            <span class="icon">${cat?.emoji || "📌"}</span>
            <span class="name">${cat?.name || e.category_id || "—"}</span>
            <span class="amount">${formatAmount(e.amount)} ${e.currency}</span>
            <span class="${e.ok ? "ok" : "pending"}">${e.ok ? "✓" : "…"}</span>
        `;
        list.appendChild(li);
    }
}

function sumByCurrency(list) {
    const map = new Map();
    for (const e of list) {
        map.set(e.currency, (map.get(e.currency) || 0) + e.amount);
    }
    return map;
}
function formatMultiCcy(map) {
    if (map.size === 0) return "—";
    return [...map.entries()]
        .map(([ccy, n]) => `${formatAmount(n)} ${ccy}`)
        .join(" + ");
}
function formatAmount(n) {
    if (n === Math.floor(n)) return n.toLocaleString("ru-RU");
    return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function renderCurrencyPicker() {
    const grid = $("#currency-grid");
    grid.innerHTML = "";
    for (const c of state.currencies) {
        const btn = document.createElement("button");
        btn.className = c.code === state.currency ? "active" : "";
        btn.innerHTML = `<span class="ccy-code">${c.emoji || ""} ${c.code}</span><span class="ccy-name">${c.name}</span>`;
        btn.addEventListener("click", () => {
            state.currency = c.code;
            renderDisplay();
            renderSideActions();
            closeModals();
        });
        grid.appendChild(btn);
    }
}

async function renderSyncScreen() {
    const body = $("#sync-body");
    body.innerHTML = `<p class="hint">Получение статуса…</p>`;

    const sentCount = state.sentExpenses.length;
    const lastSent = state.sentExpenses[state.sentExpenses.length - 1];
    body.innerHTML = `
        <div class="row">
            <span class="label">Отправлено с этого устройства</span>
            <b>${sentCount}</b> ${sentCount === 1 ? "трата" : "трат"}
        </div>
        <div class="row">
            <span class="label">Последняя отправка</span>
            ${lastSent
              ? `<b>${formatAmount(lastSent.amount)} ${lastSent.currency}</b> · ${lastSent.sent_at?.slice(0,16).replace("T"," ") || ""}`
              : "—"}
        </div>
        <div class="row">
            <span class="label">MacBook</span>
            <span class="hint">Статус MacBook виден через бота: /sync</span>
        </div>
        <p class="hint" style="margin-top:14px;">
            Mini App не запрашивает MacBook напрямую — он за NAT и не онлайн постоянно. Бот через
            <code>/sync</code> покажет когда был последний sync (heartbeat-based).
        </p>
    `;
}

function renderHistoryScreen() {
    const list = $("#history-list");
    list.innerHTML = "";

    if (state.sentExpenses.length === 0) {
        list.innerHTML = `<p class="hint">Тут будут только траты, которые вы внесли через это приложение. Полная история — в Excel на компьютере.</p>`;
        return;
    }
    const byDate = new Map();
    for (const e of [...state.sentExpenses].reverse()) {
        const key = e.date;
        if (!byDate.has(key)) byDate.set(key, []);
        byDate.get(key).push(e);
    }
    for (const [date, items] of byDate) {
        const head = document.createElement("div");
        head.className = "day-head";
        head.textContent = humanDate(date);
        list.appendChild(head);
        for (const e of items) {
            const cat = state.categories.find(c => c.id === e.category_id);
            const li = document.createElement("div");
            li.className = "recent";
            li.innerHTML = `<ul style="list-style:none;padding:0;margin:0;">
                <li><span class="icon">${cat?.emoji || "📌"}</span>
                <span class="name">${cat?.name || "—"}${e.note ? ` <small style="color:var(--hint)">— ${escapeHtml(e.note)}</small>` : ""}</span>
                <span class="amount">${formatAmount(e.amount)} ${e.currency}</span>
                <span class="${e.ok ? "ok" : "pending"}">${e.ok ? "✓" : "…"}</span></li>
            </ul>`;
            list.appendChild(li);
        }
    }
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function humanDate(iso) {
    const today = todayISO();
    if (iso === today) return "Сегодня";
    if (iso === dateShift(-1)) return "Вчера";
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

// ───────────────────────────────────────────────────────────── interactions
function onNumpadTap(button) {
    const key = button.dataset.key;
    if (key === "back") {
        state.amount = state.amount.length > 1 ? state.amount.slice(0, -1) : "0";
    } else if (key === "dot") {
        if (!state.amount.includes(".")) {
            state.amount = state.amount + ".";
        }
    } else {
        const ch = button.textContent.trim();
        if (state.amount === "0") {
            state.amount = ch;
        } else {
            const [intPart, fracPart] = state.amount.split(".");
            // Ограничение: 2 знака после точки
            if (fracPart !== undefined && fracPart.length >= 2) return;
            if (state.amount.length >= 12) return;
            state.amount += ch;
        }
    }
    tg?.HapticFeedback?.selectionChanged?.();
    renderDisplay();
    renderCategories();
}

async function onCategoryTap(cat) {
    const amount = parseFloat(state.amount);
    if (!(amount > 0)) {
        toast("Введите сумму", "err");
        return;
    }
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
    // Optimistic: добавляем в локальный список как pending
    const localEntry = { ...expense, ok: false, sent_at: expense.created_at };
    state.sentExpenses.push(localEntry);
    saveLocal();
    renderFooter();

    try {
        await postExpense(expense);
        localEntry.ok = true;
        saveLocal();
        renderFooter();
        toast(`✓ ${formatAmount(amount)} ${state.currency} → ${cat.name}`, "ok");
        // Сброс
        state.amount = "0";
        state.note = "";
        renderDisplay();
        renderSideActions();
        renderCategories();
    } catch (e) {
        localEntry.error = String(e.message || e);
        saveLocal();
        renderFooter();
        toast("Ошибка: " + (e.message || e), "err");
    }
}

// ───────────────────────────────────────────────────────────── init
function bindEvents() {
    $$("#numpad button").forEach(b => b.addEventListener("click", () => onNumpadTap(b)));

    $("#open-menu").addEventListener("click", () => showModal("menu"));
    $("#open-currency").addEventListener("click", () => { renderCurrencyPicker(); showModal("currency"); });
    $("#open-date").addEventListener("click", () => {
        $("#date-input").value = state.date;
        showModal("date");
    });
    $("#open-note").addEventListener("click", () => {
        $("#note-input").value = state.note;
        showModal("note");
    });
    $("#open-sync").addEventListener("click", () => { showScreen("sync"); renderSyncScreen(); });
    $("#sync-refresh").addEventListener("click", () => renderSyncScreen());

    $$("[data-close]").forEach(el => el.addEventListener("click", closeModals));
    $$("[data-back]").forEach(el => el.addEventListener("click", () => showScreen("main")));

    $$("[data-go]").forEach(el => el.addEventListener("click", () => {
        closeModals();
        const target = el.dataset.go;
        if (target === "history") { renderHistoryScreen(); showScreen("history"); }
        else if (target === "sync") { showScreen("sync"); renderSyncScreen(); }
    }));

    $$("[data-date-shift]").forEach(el => el.addEventListener("click", () => {
        const days = parseInt(el.dataset.dateShift, 10);
        state.date = dateShift(days);
        renderSideActions();
        closeModals();
    }));
    $("#date-input").addEventListener("change", (e) => {
        if (e.target.value) state.date = e.target.value;
        renderSideActions();
    });

    $("#note-save").addEventListener("click", () => {
        state.note = $("#note-input").value.trim();
        renderSideActions();
        closeModals();
    });
    $("#note-clear").addEventListener("click", () => {
        $("#note-input").value = "";
        state.note = "";
        renderSideActions();
        closeModals();
    });

    // Touch swipe для пагинации категорий
    const cats = $(".categories");
    let touchX = 0;
    cats.addEventListener("touchstart", e => { touchX = e.touches[0].clientX; });
    cats.addEventListener("touchend", e => {
        const dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 50) {
            const totalPages = Math.max(1, Math.ceil(state.categories.length / state.catsPerPage));
            state.catPage = (state.catPage + (dx < 0 ? 1 : -1) + totalPages) % totalPages;
            renderCategories();
        }
    });
}

async function init() {
    if (tg) {
        tg.ready();
        tg.expand();
        // Применяем header/footer цвета Telegram
        if (tg.setHeaderColor) tg.setHeaderColor("bg_color");
    }

    bindEvents();
    render();

    await bootstrap();
    // Если в bootstrap есть аккаунты — выберем валюту по умолчанию из первого
    // активного account'а (Расходы ОК исторически RSD).
    const firstCcy = state.accounts.find(a => a.type !== "external")?.currency || "RSD";
    state.currency = firstCcy;
    render();
}

init();
