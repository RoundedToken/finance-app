// Mini App v6 — translate-slider, swipe direction lock, focus-guard, inline edit.

const tg = window.Telegram?.WebApp;
const WORKER_BASE = "https://finances-worker.stepan-mikhalev-99.workers.dev";

const WEEKDAYS_SHORT = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
const MONTHS_GEN = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];

const SETTINGS_KEY = "finances.settings.v1";

function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { return {}; }
}
function saveSettings(patch) {
    const s = { ...loadSettings(), ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ───────────── state
const state = {
    accounts: [], categories: [], allCategories: [], currencies: [], expenses: [],
    rates: { date: null, base: "EUR", quotes: {} },
    baseCurrency: loadSettings().baseCurrency || "EUR",
    bootstrapped: false, bootstrapError: null,
    amount: "0", currency: "RSD", date: todayISO(), note: "",
    catPage: 0, catsPerPage: 8,
    editingId: null, editingCategory: null,
};

function todayISO() { return new Date().toISOString().slice(0, 10); }
function dateShift(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
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
    if (!r.ok) { const t = await r.text().catch(() => r.statusText); throw new Error(`${r.status} ${t.slice(0, 200)}`); }
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
        state.rates = data.rates || { date: null, base: "EUR", quotes: {} };
        state.bootstrapped = true; state.bootstrapError = null;
    } catch (e) { state.bootstrapError = String(e.message || e); }
}
async function postExpense(e) { return await api("/v1/expenses", { method: "POST", body: JSON.stringify(e) }); }
async function putExpense(id, patch) { return await api(`/v1/expenses/${id}`, { method: "PUT", body: JSON.stringify(patch) }); }
async function delExpense(id) { return await api(`/v1/expenses/${id}`, { method: "DELETE" }); }

// ───────────── DOM helpers
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
function showScreen(name) {
    $$(".screen").forEach(s => s.hidden = true);
    const t = $(`#screen-${name}`); if (t) t.hidden = false;
    $("#app").scrollTop = 0;
}
function openModal(name) {
    const m = $(`#modal-${name}`);
    if (!m.hidden && m.classList.contains("show")) return;
    m.hidden = false;
    const card = m.querySelector(".modal-card");
    if (card) card.scrollTop = 0;
    // Force reflow → анимация slide-up на следующем кадре
    void m.offsetHeight;
    m.classList.add("show");
}
function closeModals() {
    try { document.activeElement?.blur?.(); } catch {}
    $$(".modal:not([hidden])").forEach(m => {
        if (!m.classList.contains("show")) { m.hidden = true; return; }
        m.classList.remove("show");
        const card = m.querySelector(".modal-card");
        let done = false;
        const finish = () => {
            if (done) return; done = true;
            m.hidden = true;
            card?.removeEventListener("transitionend", onEnd);
        };
        const onEnd = (e) => { if (e.target === card && e.propertyName === "transform") finish(); };
        card?.addEventListener("transitionend", onEnd);
        // fallback на случай если transitionend не сработает
        setTimeout(finish, 340);
    });
}
function toast(msg, kind = "ok") {
    const el = $("#toast");
    el.textContent = msg;
    el.className = `toast ${kind} show`;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2000);
}

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
    let prefix;
    if (iso === today) prefix = "Сегодня";
    else if (iso === yest) prefix = "Вчера";
    else {
        const dateNum = d.getDate();
        const month = MONTHS_GEN[d.getMonth()];
        const year = d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : "";
        prefix = `${dateNum} ${month}${year}`;
    }
    const wd = WEEKDAYS_SHORT[d.getDay()];
    return { prefix, weekday: wd };
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function amountHTML(amount, currency) {
    return `<span class="num">${fmt(amount)}</span><span class="flag">${flagOf(currency)}</span><span class="ccy">${currency}</span>`;
}

/** Конверсия amount из currency в state.baseCurrency.
 *  Все курсы хранятся как 1 EUR = rate ccy → переход через EUR. */
function rateEURto(quote) {
    if (quote === "EUR") return 1;
    const r = state.rates.quotes[quote];
    return (r && isFinite(r) && r > 0) ? r : null;
}
function convertToBase(amount, currency) {
    if (currency === state.baseCurrency) return amount;
    const rCcy = rateEURto(currency);          // 1 EUR = rCcy currency
    const rBase = rateEURto(state.baseCurrency);
    if (!rCcy || !rBase) return null;
    const inEUR = amount / rCcy;
    return inEUR * rBase;
}

/** Возвращает HTML для day-total: оригинальные суммы + конверсия в base, если есть смысл. */
function dayTotalHTML(sums) {
    if (sums.size === 0) return `<span style="color:var(--text-muted);font-weight:400;">—</span>`;
    const originals = [...sums.entries()].map(([c, n]) => amountHTML(n, c)).join(" ");
    // Считаем общую сумму в base
    let baseTotal = 0;
    let allConverted = true;
    for (const [ccy, n] of sums) {
        const c = convertToBase(n, ccy);
        if (c == null) { allConverted = false; break; }
        baseTotal += c;
    }
    const showConversion = allConverted && (sums.size > 1 || !sums.has(state.baseCurrency));
    const convHTML = showConversion
        ? `<span class="base-conv">≈ <span class="num">${fmt(Math.round(baseTotal * 100) / 100)}</span> ${flagOf(state.baseCurrency)} ${state.baseCurrency}</span>`
        : "";
    return originals + convHTML;
}

// ───────────── render
function render() {
    renderDisplay(); renderSideActions(); renderCategories(); renderRecentDays();
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

// Категории — настоящий slider с translate
function renderCategories() {
    const track = $("#cat-track");
    const pager = $("#categories-pager");
    track.innerHTML = "";
    pager.innerHTML = "";

    if (!state.bootstrapped) {
        track.innerHTML = `<div class="categories-page"><div style="grid-column:1/-1;text-align:center;color:var(--hint);padding:18px;font-size:12px;">
            ${state.bootstrapError ? "Ошибка: " + escapeHtml(state.bootstrapError) : "Загрузка категорий…"}
        </div></div>`;
        return;
    }

    const cats = state.categories;
    const totalPages = Math.max(1, Math.ceil(cats.length / state.catsPerPage));
    if (state.catPage >= totalPages) state.catPage = 0;
    const amountValid = parseFloat(state.amount) > 0;

    for (let p = 0; p < totalPages; p++) {
        const page = document.createElement("div");
        page.className = "categories-page";
        const slice = cats.slice(p * state.catsPerPage, (p + 1) * state.catsPerPage);
        for (const cat of slice) {
            const btn = document.createElement("button");
            btn.className = "cat" + (amountValid ? "" : " disabled");
            btn.style.background = cat.color || "var(--bg-elevated)";
            btn.innerHTML = `<span class="emoji">${cat.emoji || "📌"}</span><span class="name">${escapeHtml(cat.name)}</span>`;
            btn.addEventListener("click", () => onCategoryTap(cat));
            page.appendChild(btn);
        }
        // Spacer чтобы page не сжимался
        for (let i = slice.length; i < state.catsPerPage; i++) {
            const stub = document.createElement("div");
            stub.className = "cat-spacer";
            page.appendChild(stub);
        }
        track.appendChild(page);
    }
    // Применить текущий transform
    snapTo(state.catPage, /*animate*/ false);

    for (let i = 0; i < totalPages; i++) {
        const dot = document.createElement("span");
        dot.className = "dot" + (i === state.catPage ? " active" : "");
        dot.addEventListener("click", () => snapTo(i, true));
        pager.appendChild(dot);
    }
}

function snapTo(page, animate) {
    state.catPage = page;
    const track = $("#cat-track");
    const viewport = $(".categories-viewport");
    if (!viewport || !track) return;
    const w = viewport.getBoundingClientRect().width;
    if (animate) track.classList.remove("dragging");
    else track.classList.add("dragging");
    requestAnimationFrame(() => {
        track.style.transform = `translateX(${-page * w}px)`;
        if (!animate) {
            // Без анимации — снимем dragging после кадра
            requestAnimationFrame(() => track.classList.remove("dragging"));
        }
    });
    // Pager dots
    $$("#categories-pager .dot").forEach((d, i) => d.classList.toggle("active", i === page));
}

// ── Recent (main) ─────────────────────────────────────────────
function renderRecentDays() {
    const container = $("#recent-days");
    container.innerHTML = "";
    for (const day of [todayISO(), dateShift(-1)]) {
        container.appendChild(buildDayGroup(day, /*swipeable*/ false, /*showEmpty*/ true));
    }
}
function buildDayGroup(day, swipeable, showEmpty) {
    const items = state.expenses.filter(e => e.date === day);
    const block = document.createElement("div");
    block.className = "day-group";

    const sums = new Map();
    for (const e of items) sums.set(e.currency, (sums.get(e.currency) || 0) + e.amount);
    const totalHtml = sums.size === 0
        ? (showEmpty ? `<span style="color:var(--text-muted);font-weight:400;">—</span>` : "")
        : dayTotalHTML(sums);

    const t = humanDayTitle(day);
    const head = document.createElement("div");
    head.className = "day-head";
    head.innerHTML = `
        <span class="day-title">${escapeHtml(t.prefix)}<small>${escapeHtml(t.weekday)}</small></span>
        <span class="day-total">${totalHtml}</span>
    `;
    block.appendChild(head);

    if (items.length || !showEmpty) {
        const ul = document.createElement("ul");
        ul.className = "day-rows";
        for (const e of items) ul.appendChild(buildExpenseRow(e, swipeable));
        block.appendChild(ul);
    }
    return block;
}

function buildExpenseRow(e, swipeable) {
    const cat = catOf(e.category_id);
    const noteHtml = e.note ? `<div class="note">${escapeHtml(e.note)}</div>` : "";
    const row = document.createElement("div");
    row.className = "day-row";
    row.innerHTML = `
        <span class="icon" style="background:${cat?.color || "var(--bg-elevated)"}">${cat?.emoji || "📌"}</span>
        <div class="body">
            <div class="name">${escapeHtml(cat?.name || "—")}</div>
            ${noteHtml}
        </div>
        <span class="amount">${amountHTML(e.amount, e.currency)}</span>
    `;

    if (!swipeable) {
        const li = document.createElement("li");
        li.appendChild(row);
        row.addEventListener("click", () => openEditModal(e));
        return li;
    }
    const li = document.createElement("li");
    const wrap = document.createElement("div");
    wrap.className = "day-row-wrap";

    const reveal = document.createElement("button");
    reveal.className = "reveal";
    reveal.textContent = "✕";
    reveal.addEventListener("click", (ev) => {
        ev.stopPropagation();
        confirmAndDelete(e.id);
    });
    wrap.appendChild(reveal);
    wrap.appendChild(row);

    attachSwipeToDelete(row, e);
    li.appendChild(wrap);
    return li;
}

// iOS-like swipe-to-delete
function attachSwipeToDelete(row, expense) {
    const wrap = row.parentElement;  // .day-row-wrap
    const REVEAL = 64, OPEN_AT = 28;
    let startX = 0, startY = 0, dx = 0, dy = 0;
    let active = false, opened = false, moved = false, dirLocked = null;

    function setState(s) {
        if (s) wrap.setAttribute("data-state", s);
        else wrap.removeAttribute("data-state");
    }

    row.addEventListener("touchstart", (e) => {
        const t = e.touches[0];
        startX = t.clientX; startY = t.clientY;
        dx = dy = 0; moved = false; dirLocked = null;
        active = true;
        row.style.transition = "none";
    }, { passive: true });

    row.addEventListener("touchmove", (e) => {
        if (!active) return;
        const t = e.touches[0];
        dx = t.clientX - startX;
        dy = t.clientY - startY;
        if (!dirLocked) {
            if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
                dirLocked = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
                if (dirLocked === "h") setState("dragging");
            }
        }
        if (dirLocked === "v") return;
        moved = moved || Math.abs(dx) > 4;
        let pos = (opened ? -REVEAL : 0) + dx;
        if (pos > 0) pos = 0;
        if (pos < -REVEAL * 1.3) pos = -REVEAL * 1.3;
        row.style.transform = `translateX(${pos}px)`;
    }, { passive: true });

    row.addEventListener("touchend", () => {
        if (!active) return;
        active = false;
        row.style.transition = "";  // вернёмся к CSS transition: var(--dur) var(--ease)
        if (dirLocked === "v") return;
        const projected = (opened ? -REVEAL : 0) + dx;
        if (projected < -OPEN_AT) {
            opened = true;
            row.style.transform = `translateX(-${REVEAL}px)`;
            setState("open");
        } else {
            opened = false;
            row.style.transform = "translateX(0)";
            setState(null);
        }
    });

    row.addEventListener("click", (e) => {
        if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; return; }
        if (opened) {
            opened = false;
            row.style.transition = "";
            row.style.transform = "translateX(0)";
            setState(null);
            return;
        }
        openEditModal(expense);
    });
}

function confirmAndDelete(id) {
    if (!confirm("Удалить эту запись?")) return;
    delExpense(id).then(() => {
        state.expenses = state.expenses.filter(e => e.id !== id);
        render();
        if (!$("#screen-history").hidden) renderHistoryScreen();
        toast("🗑️ Удалено", "ok");
    }).catch(e => toast("Ошибка: " + e.message, "err"));
}

function renderHistoryScreen() {
    const list = $("#history-list");
    list.innerHTML = "";
    if (!state.expenses.length) {
        list.innerHTML = `<p class="history-hint">Пока пусто.</p>`;
        return;
    }
    const byDate = new Map();
    for (const e of state.expenses) {
        if (!byDate.has(e.date)) byDate.set(e.date, []);
        byDate.get(e.date).push(e);
    }
    const dates = [...byDate.keys()].sort((a, b) => a < b ? 1 : -1);
    for (const d of dates) {
        const block = document.createElement("div");
        block.className = "day-group";
        const items = byDate.get(d);
        const sums = new Map();
        for (const e of items) sums.set(e.currency, (sums.get(e.currency) || 0) + e.amount);
        const totalHtml = dayTotalHTML(sums);
        const t = humanDayTitle(d);
        const head = document.createElement("div");
        head.className = "day-head";
        head.innerHTML = `
            <span class="day-title">${escapeHtml(t.prefix)}<small>${escapeHtml(t.weekday)}</small></span>
            <span class="day-total">${totalHtml}</span>
        `;
        block.appendChild(head);
        const ul = document.createElement("ul");
        ul.className = "day-rows";
        for (const e of items) ul.appendChild(buildExpenseRow(e, /*swipeable*/ true));
        block.appendChild(ul);
        list.appendChild(block);
    }
}

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

function renderSettings() {
    const grid = $("#settings-base-grid");
    grid.innerHTML = "";
    for (const c of state.currencies) {
        const btn = document.createElement("button");
        btn.className = c.code === state.baseCurrency ? "active" : "";
        btn.innerHTML = `<span class="ccy-flag">${c.emoji || "💱"}</span>
                         <span class="ccy-code">${c.code}</span>
                         <span class="ccy-name">${escapeHtml(c.name)}</span>`;
        btn.addEventListener("click", () => {
            state.baseCurrency = c.code;
            saveSettings({ baseCurrency: c.code });
            renderSettings();
            render();
            if (!$("#screen-history").hidden) renderHistoryScreen();
        });
        grid.appendChild(btn);
    }
    const info = $("#settings-rates-info");
    if (state.rates.date) {
        info.textContent = `Курсы от ${state.rates.date}, источник open.er-api.com`;
    } else {
        info.textContent = "Курсы ещё не загружены";
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
    try { document.activeElement?.blur?.(); } catch {}
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
        const idx = state.expenses.findIndex(e => e.id === id);
        if (idx >= 0) state.expenses[idx] = { ...state.expenses[idx], ...patch, updated_at: new Date().toISOString() };
        closeModals();
        render();
        if (!$("#screen-history").hidden) renderHistoryScreen();
        toast("✓ Сохранено", "ok");
    } catch (e) { toast("Ошибка: " + e.message, "err"); }
}

async function deleteEntry() {
    if (!confirm("Удалить эту запись?")) return;
    const id = state.editingId;
    try {
        await delExpense(id);
        state.expenses = state.expenses.filter(e => e.id !== id);
        closeModals();
        render();
        if (!$("#screen-history").hidden) renderHistoryScreen();
        toast("🗑️ Удалено", "ok");
    } catch (e) { toast("Ошибка: " + e.message, "err"); }
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
        id: uuid4(), date: state.date, amount, currency: state.currency,
        category_id: cat.id, note: state.note || null, source: "mini_app",
        created_at: new Date().toISOString(),
    };
    state.expenses.unshift(expense);
    render();
    try {
        await postExpense(expense);
        toast(`✓ ${fmt(amount)} ${state.currency} → ${cat.name}`, "ok");
        state.amount = "0"; state.note = "";
        renderDisplay(); renderSideActions(); renderCategories();
    } catch (e) {
        state.expenses = state.expenses.filter(x => x.id !== expense.id);
        render();
        toast("Ошибка: " + e.message, "err");
    }
}

// ───────────── Category slider — настоящий drag
function setupCategorySwipe() {
    const viewport = $(".categories-viewport");
    const track = $("#cat-track");
    if (!viewport || !track) return;
    let st = null;

    viewport.addEventListener("touchstart", (e) => {
        const t = e.touches[0];
        const w = viewport.getBoundingClientRect().width;
        st = { x0: t.clientX, y0: t.clientY, page: state.catPage, dir: null, w };
        track.classList.add("dragging");
    }, { passive: true });

    viewport.addEventListener("touchmove", (e) => {
        if (!st) return;
        const t = e.touches[0];
        const dx = t.clientX - st.x0;
        const dy = t.clientY - st.y0;
        if (!st.dir) {
            if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
                st.dir = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
            } else { return; }
        }
        if (st.dir === "h") {
            // блокируем вертикальный scroll
            if (e.cancelable) e.preventDefault();
            const offset = -st.page * st.w + dx;
            track.style.transform = `translateX(${offset}px)`;
        }
    }, { passive: false });

    function finish(e) {
        if (!st) return;
        const local = st; st = null;
        if (local.dir !== "h") {
            track.classList.remove("dragging");
            return;
        }
        const t = e.changedTouches[0];
        const dx = t.clientX - local.x0;
        const total = Math.max(1, Math.ceil(state.categories.length / state.catsPerPage));
        const threshold = local.w * 0.18; // 18% ширины — переключение
        let next = local.page;
        if (dx < -threshold) next = (local.page + 1) % total;
        else if (dx > threshold) next = (local.page - 1 + total) % total;
        snapTo(next, /*animate*/ true);
    }

    viewport.addEventListener("touchend", finish, { passive: true });
    viewport.addEventListener("touchcancel", () => {
        if (st) { snapTo(st.page, true); st = null; }
    });
}

// ───────────── Focus guard для edit modal
function setupFocusGuard(modal) {
    let guarded = false;

    function isInput(el) { return el?.matches?.("input, textarea, select"); }

    modal.addEventListener("focusin", (e) => {
        if (isInput(e.target)) {
            guarded = true;
            modal.querySelector(".modal-card")?.setAttribute("data-focused", "1");
        }
    });
    modal.addEventListener("focusout", () => {
        setTimeout(() => {
            if (!isInput(document.activeElement) || !modal.contains(document.activeElement)) {
                guarded = false;
                modal.querySelector(".modal-card")?.removeAttribute("data-focused");
            }
        }, 50);
    });

    // Перехват tap'ов вне сфокусированного input
    function handlePointer(e) {
        if (!guarded) return;
        const active = document.activeElement;
        if (!isInput(active)) { guarded = false; return; }
        if (active.contains(e.target) || e.target === active) return;

        // Если тап на другой input/select/textarea — заблокировать, не активировать
        const tappedInput = e.target.closest("input, textarea, select");
        if (tappedInput && tappedInput !== active) {
            e.preventDefault();
            e.stopPropagation();
            active.blur();
            return;
        }

        // Тап на button (Save/Delete/swipe-action) — дать сработать, но первым делом blur
        // Тап на пустое место — blur и стоп пропагации (чтобы не активировать).
        active.blur();
        if (!e.target.closest("button")) {
            e.preventDefault();
            e.stopPropagation();
        }
    }
    modal.addEventListener("pointerdown", handlePointer, true);
}

// Enter в textarea → blur
function setupTextareaEnter(textarea) {
    textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            textarea.blur();
        }
    });
}

// ───────────── init
function bindEvents() {
    $$("#numpad button").forEach(b => b.addEventListener("click", () => onNumpadTap(b)));

    $("#open-menu").addEventListener("click", () => openModal("menu"));
    $("#open-history").addEventListener("click", () => { renderHistoryScreen(); showScreen("history"); });
    $("#open-settings").addEventListener("click", () => {
        closeModals();
        setTimeout(() => { renderSettings(); openModal("settings"); }, 300);
    });
    $("#open-currency").addEventListener("click", () => { renderCurrencyPicker(); openModal("currency"); });
    $("#open-date").addEventListener("click", () => { $("#date-input").value = state.date; openModal("date"); });
    $("#open-note").addEventListener("click", () => { $("#note-input").value = state.note; openModal("note"); });

    $$("[data-close]").forEach(el => el.addEventListener("click", closeModals));
    $$("[data-back]").forEach(el => el.addEventListener("click", () => showScreen("main")));
    $$("[data-go]").forEach(el => el.addEventListener("click", () => {
        const t = el.dataset.go;
        closeModals();
        if (t === "history") { renderHistoryScreen(); showScreen("history"); }
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
    setupTextareaEnter($("#note-input"));
    setupTextareaEnter($("#edit-note"));

    $("#edit-save").addEventListener("click", saveEdit);
    $("#edit-delete").addEventListener("click", deleteEntry);

    setupFocusGuard($("#modal-edit"));
    setupFocusGuard($("#modal-note"));
    setupCategorySwipe();
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

// Если viewport ресайзится (rotate) — пересчитать transform
window.addEventListener("resize", () => snapTo(state.catPage, false));

init();
