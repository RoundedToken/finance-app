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
    statsPeriod: { type: "month", offset: 0 },
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

// Сколько дней истории рендерим за раз. На iOS Telegram WebView 1800+ строк со
// swipe-handlers крашит экран — пагинируем чанками + lazy load on scroll.
const HISTORY_PAGE_DAYS = 30;

function renderHistoryScreen() {
    const list = $("#history-list");
    list.innerHTML = "";
    if (!state.expenses.length) {
        list.innerHTML = `<p class="history-hint">Пока пусто.</p>`;
        return;
    }
    // Группируем по дате (один проход).
    const byDate = new Map();
    for (const e of state.expenses) {
        if (!byDate.has(e.date)) byDate.set(e.date, []);
        byDate.get(e.date).push(e);
    }
    const dates = [...byDate.keys()].sort((a, b) => a < b ? 1 : -1);
    state.historyCtx = { dates, byDate, rendered: 0 };
    renderHistoryChunk();
}

function renderHistoryChunk() {
    const ctx = state.historyCtx;
    if (!ctx) return;
    const list = $("#history-list");
    // Удалить старый sentinel/btn если есть
    list.querySelectorAll(".history-loader").forEach(el => el.remove());

    const end = Math.min(ctx.rendered + HISTORY_PAGE_DAYS, ctx.dates.length);
    for (let i = ctx.rendered; i < end; i++) {
        const d = ctx.dates[i];
        const items = ctx.byDate.get(d);
        const sums = new Map();
        for (const e of items) sums.set(e.currency, (sums.get(e.currency) || 0) + e.amount);
        const totalHtml = dayTotalHTML(sums);
        const t = humanDayTitle(d);

        const block = document.createElement("div");
        block.className = "day-group";
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
    ctx.rendered = end;

    // Sentinel + кнопка для следующего чанка
    if (ctx.rendered < ctx.dates.length) {
        const left = ctx.dates.length - ctx.rendered;
        const loader = document.createElement("div");
        loader.className = "history-loader";
        loader.innerHTML = `
            <button class="history-loader-btn">
                Показать ещё <small>(дней осталось: ${left})</small>
            </button>
        `;
        loader.querySelector("button").addEventListener("click", () => renderHistoryChunk());
        list.appendChild(loader);

        // Авто-подгрузка при подходе к sentinel через IntersectionObserver
        if ("IntersectionObserver" in window) {
            const io = new IntersectionObserver((entries) => {
                if (entries.some(e => e.isIntersecting)) {
                    io.disconnect();
                    renderHistoryChunk();
                }
            }, { root: $("#app"), rootMargin: "200px" });
            io.observe(loader);
        }
    } else if (ctx.rendered > HISTORY_PAGE_DAYS) {
        // Опционально — финальный маркер «конец»
        const done = document.createElement("div");
        done.className = "history-loader history-loader-done";
        done.textContent = "— конец истории —";
        list.appendChild(done);
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
        info.textContent = `Курсы от ${state.rates.date}, источник Google (GOOGLEFINANCE)`;
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
        else if (t === "stats") { openStatsScreen(); }
    }));
    $$("#stats-tabs button").forEach(b => b.addEventListener("click", () => {
        state.statsPeriod = { type: b.dataset.period, offset: 0 };
        renderStatsScreen();
    }));
    $("#stats-prev").addEventListener("click", () => { state.statsPeriod.offset -= 1; renderStatsScreen(); });
    $("#stats-next").addEventListener("click", () => {
        if (state.statsPeriod.offset < 0) { state.statsPeriod.offset += 1; renderStatsScreen(); }
    });
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

// ───────────── Stats screen ────────────────────────────────────
function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
}
function addDays(d, n)   { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function addMonths(d, n) { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; }
function startOfWeek(d) {
    const day = d.getDay() || 7; // Sunday → 7
    const r = new Date(d);
    r.setDate(d.getDate() - day + 1);
    r.setHours(0, 0, 0, 0);
    return r;
}
function pluralRu(n, forms) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function diffDaysISO(from, to) {
    const f = new Date(from + "T00:00:00"), t = new Date(to + "T00:00:00");
    return Math.round((t - f) / 86400000) + 1;
}

function getStatsRange(type, offset) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (type === "week") {
        const start = addDays(startOfWeek(today), offset * 7);
        const end = addDays(start, 6);
        const sameMonth = start.getMonth() === end.getMonth();
        const label = sameMonth
            ? `${start.getDate()}–${end.getDate()} ${MONTHS_GEN[start.getMonth()]}`
            : `${start.getDate()} ${MONTHS_GEN[start.getMonth()]} – ${end.getDate()} ${MONTHS_GEN[end.getMonth()]}`;
        return { type, from: isoDate(start), to: isoDate(end), label };
    }
    if (type === "month") {
        const ref = addMonths(today, offset);
        const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
        const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
        const monthName = capitalize(MONTHS_GEN[ref.getMonth()].replace(/я$/, "ь").replace(/а$/, ""));
        // Для месяцев в родительном падеже нет — берём именительный через Date#toLocaleString.
        const label = capitalize(ref.toLocaleString("ru-RU", { month: "long", year: "numeric" }).replace(" г.", ""));
        return { type, from: isoDate(start), to: isoDate(end), label };
    }
    if (type === "year") {
        const y = today.getFullYear() + offset;
        return { type, from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
    }
    // "all"
    if (!state.expenses.length) {
        return { type: "all", from: isoDate(today), to: isoDate(today), label: "Всё время" };
    }
    const dates = state.expenses.map(e => e.date).filter(Boolean);
    const min = dates.reduce((a, b) => a < b ? a : b);
    const max = dates.reduce((a, b) => a > b ? a : b);
    return { type: "all", from: min, to: max, label: "Всё время" };
}

function aggregateForPeriod(from, to) {
    let total = 0, missing = 0, count = 0;
    const byCat = new Map(), byDate = new Map();
    for (const e of state.expenses) {
        if (e.date < from || e.date > to) continue;
        count++;
        const c = convertToBase(e.amount, e.currency);
        if (c == null) { missing++; continue; }
        total += c;
        byCat.set(e.category_id, (byCat.get(e.category_id) || 0) + c);
        byDate.set(e.date, (byDate.get(e.date) || 0) + c);
    }
    return { total, missing, count, byCat, byDate };
}

// Дискриминированная палитра для charts (donut + cat list).
// Hue-разнесённые тёплые/холодные тона при одинаковой светлоте; контрастны
// на тёмном фоне и легко различимы между собой. Пастельные cat.color остаются
// только для тайлов на главной.
// Порядок цветов специально такой, что соседние индексы максимально разнесены
// по hue — даже когда в donut выпали топ-2 (а не 8) категории, они не сливаются.
const CHART_PALETTE = [
    "#a78bfa", // 1. violet (hue ~270°)
    "#fbbf24", // 2. amber  (~45°)
    "#34d399", // 3. emerald (~160°)
    "#fb7185", // 4. rose   (~350°)
    "#22d3ee", // 5. cyan   (~190°)
    "#a3e635", // 6. lime   (~80°)
    "#f472b6", // 7. pink   (~320°)
    "#60a5fa", // 8. sky    (~220°)
    "#fdba74", // 9. orange (~30°)
    "#c084fc", //10. light-purple (~280°)
    "#86efac", //11. light-green (~140°)
    "#fca5a5", //12. light-red   (~0°)
];
const CHART_OTHER = "#5a5378";   // donut «Прочее»
const CHART_TAIL  = "#6b6494";   // tail в списке (топ-N+) — мягкий лиловый

function buildStatsPalette(byCat) {
    const items = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    const TOP_N = 8;
    const colorByCat = new Map();
    items.forEach(([cid, sum], i) => {
        colorByCat.set(cid, i < TOP_N ? CHART_PALETTE[i] : CHART_TAIL);
    });
    return { items, colorByCat, topIds: items.slice(0, TOP_N).map(([cid]) => cid) };
}

function openStatsScreen() { showScreen("stats"); renderStatsScreen(); }

function renderStatsScreen() {
    $$("#stats-tabs button").forEach(b => b.classList.toggle("active", b.dataset.period === state.statsPeriod.type));
    const range = getStatsRange(state.statsPeriod.type, state.statsPeriod.offset);
    $("#stats-period-label").textContent = range.label;
    $("#stats-next").disabled = state.statsPeriod.offset >= 0 || range.type === "all";
    $("#stats-prev").disabled = range.type === "all";

    const agg = aggregateForPeriod(range.from, range.to);
    let prevAgg = null;
    if (range.type !== "all") {
        const prevRange = getStatsRange(range.type, state.statsPeriod.offset - 1);
        prevAgg = aggregateForPeriod(prevRange.from, prevRange.to);
    }

    const palette = buildStatsPalette(agg.byCat);
    renderStatsKPI(agg, prevAgg, range);
    renderStatsDonut(agg, palette);
    renderStatsCats(agg, palette);
    renderStatsTrend(agg, range);
}

function renderStatsKPI(agg, prevAgg, range) {
    const el = $("#stats-kpi");
    const flag = flagOf(state.baseCurrency);
    if (agg.count === 0) {
        el.innerHTML = `<div class="stats-kpi-empty">Трат в этом периоде нет</div>`;
        return;
    }
    const todayStr = todayISO();
    const days = diffDaysISO(range.from, range.to);
    const elapsed = (range.to >= todayStr) ? diffDaysISO(range.from, todayStr) : days;
    const avgPerDay = agg.total / Math.max(1, elapsed);

    let deltaHtml = "";
    if (prevAgg) {
        if (prevAgg.total > 0) {
            const pct = ((agg.total - prevAgg.total) / prevAgg.total) * 100;
            const cls = Math.abs(pct) < 0.5 ? "flat" : (pct > 0 ? "up" : "down");
            const arrow = cls === "flat" ? "→" : (pct > 0 ? "▲" : "▼");
            deltaHtml = `<span class="stats-kpi-delta ${cls}" title="к прошлому периоду">${arrow} ${Math.abs(pct).toFixed(0)}%</span>`;
        } else if (agg.total > 0) {
            deltaHtml = `<span class="stats-kpi-delta up" title="к прошлому периоду">▲ new</span>`;
        }
    }

    const missingHtml = agg.missing > 0
        ? `<span style="color:var(--danger);font-weight:500;">! ${agg.missing} без курса</span>`
        : "";

    el.innerHTML = `
        <div class="stats-kpi-total">
            <span>${fmt(Math.round(agg.total))}</span>
            <span class="kpi-ccy">${flag} ${state.baseCurrency}</span>
        </div>
        <div class="stats-kpi-meta">
            <span>≈ ${fmt(Math.round(avgPerDay))} ${flag}/день</span>
            <span>${agg.count} ${pluralRu(agg.count, ["трата", "траты", "трат"])}</span>
            ${deltaHtml}
            ${missingHtml}
        </div>
    `;
}

function renderStatsDonut(agg, palette) {
    const el = $("#stats-donut");
    el.innerHTML = "";
    if (agg.total <= 0) {
        el.innerHTML = `<div style="color:var(--hint);font-size:13px;padding:60px 0;">Нет данных</div>`;
        return;
    }

    // В donut: топ-8 + Прочее (всё что вне top-N).
    const groups = [];
    let other = 0;
    palette.items.forEach(([cid, sum], i) => {
        if (palette.topIds.includes(cid)) {
            groups.push({ id: cid, sum, color: palette.colorByCat.get(cid), name: catOf(cid)?.name || "—" });
        } else {
            other += sum;
        }
    });
    if (other > 0) groups.push({ id: "__other__", sum: other, color: CHART_OTHER, name: "Прочее" });

    const RAD = 42, GAP_DEG = 1.0;  // воздушный gap между сегментами для визуальной читабельности
    const C = 2 * Math.PI * RAD;
    const gapLen = (GAP_DEG / 360) * C;
    let acc = 0;
    const segs = groups.map(g => {
        const frac = g.sum / agg.total;
        const dash = Math.max(0.4, frac * C - gapLen);
        const offset = -acc;
        acc += frac * C;
        return { ...g, dash, gap: C - dash, offset };
    });

    const flag = flagOf(state.baseCurrency);
    const totalStr = fmt(Math.round(agg.total));
    // Адаптивный шрифт total: длинное число — мельче, чтобы не упиралось в стенки.
    const totalFs = totalStr.length > 8 ? 13 : totalStr.length > 6 ? 17 : totalStr.length > 4 ? 21 : 24;
    const segsSvg = segs.map(s => `
        <circle class="donut-seg" cx="50" cy="50" r="${RAD}"
                stroke="${s.color}" stroke-width="13"
                stroke-dasharray="${s.dash.toFixed(2)} ${s.gap.toFixed(2)}"
                stroke-dashoffset="${s.offset.toFixed(2)}"
                transform="rotate(-90 50 50)"
                data-cat="${s.id}"
                stroke-linecap="butt">
            <title>${escapeHtml(s.name)}: ${fmt(Math.round(s.sum))} ${state.baseCurrency} (${Math.round(s.sum / agg.total * 100)}%)</title>
        </circle>
    `).join("");

    // В SVG <text> emoji-флаги в Telegram WebView не рендерятся как color font —
    // показывают пустой плейсхолдер. Поэтому в центре donut'a выводим только код валюты.
    el.innerHTML = `
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-label="Распределение по категориям">
            <circle class="donut-track" cx="50" cy="50" r="${RAD}" stroke-width="13"></circle>
            ${segsSvg}
            <text x="50" y="48" class="donut-center-total" font-size="${totalFs}">${totalStr}</text>
            <text x="50" y="60" class="donut-center-sub">${state.baseCurrency}</text>
        </svg>
    `;
    // Stagger fade-in сегментов — премиум-ощущение появления.
    $$(".donut-seg").forEach((seg, i) => {
        seg.style.opacity = "0";
        seg.style.transition = "opacity 320ms var(--ease)";
        seg.addEventListener("click", () => {
            const id = seg.dataset.cat;
            if (id && id !== "__other__") openCategoryDrilldown(id);
        });
        setTimeout(() => { seg.style.opacity = "1"; }, 40 + i * 35);
    });
}

function renderStatsCats(agg, palette) {
    const el = $("#stats-cats");
    el.innerHTML = "";
    if (agg.byCat.size === 0 || agg.total <= 0) return;
    const flag = flagOf(state.baseCurrency);
    for (const [cid, sum] of palette.items) {
        const pct = (sum / agg.total) * 100;
        const color = palette.colorByCat.get(cid);
        const cat = catOf(cid);
        const name = cat?.name || "—";
        const emoji = cat?.emoji || "•";
        const pctStr = pct >= 1 ? Math.round(pct) : pct.toFixed(1);
        const row = document.createElement("button");
        row.className = "stats-cat";
        row.innerHTML = `
            <span class="dot" style="background:${color}"><span class="dot-emoji">${emoji}</span></span>
            <span class="cat-name">${escapeHtml(name)}</span>
            <span class="cat-pct">${pctStr}%</span>
            <span class="cat-amount">${fmt(Math.round(sum))}<span class="ccy">${flag}</span></span>
            <span class="cat-bar"><span class="cat-bar-fill" style="background:${color};width:0"></span></span>
        `;
        row.addEventListener("click", () => openCategoryDrilldown(cid));
        el.appendChild(row);
        requestAnimationFrame(() => {
            row.querySelector(".cat-bar-fill").style.width = `${pct.toFixed(2)}%`;
        });
    }
}

function renderStatsTrend(agg, range) {
    const chart = $("#stats-trend-chart");
    const axis = $("#stats-trend-axis");
    const title = $("#stats-trend-title");
    const meta = $("#stats-trend-meta");
    chart.innerHTML = "";
    axis.innerHTML = "";

    if (agg.total <= 0) {
        title.textContent = "Тренд";
        meta.textContent = "";
        return;
    }

    const flag = flagOf(state.baseCurrency);
    const todayStr = todayISO();
    const bins = []; // { label, sum, isToday, full }

    if (range.type === "week" || range.type === "month") {
        const start = new Date(range.from + "T00:00:00");
        const end = new Date(range.to + "T00:00:00");
        const isWeek = range.type === "week";
        for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
            const iso = isoDate(d);
            // Для недели — короткие weekday-метки (ПН/ВТ/…), для месяца — число дня.
            const label = isWeek ? WEEKDAYS_SHORT[d.getDay()] : String(d.getDate());
            bins.push({ label, sum: agg.byDate.get(iso) || 0, isToday: iso === todayStr, full: iso });
        }
        title.textContent = isWeek ? "По дням недели" : "Тренд по дням";
    } else {
        // year / all → по месяцам
        const start = new Date(range.from + "T00:00:00");
        const end = new Date(range.to + "T00:00:00");
        const cur = new Date(start.getFullYear(), start.getMonth(), 1);
        const tail = new Date(end.getFullYear(), end.getMonth(), 1);
        const todayYM = todayStr.slice(0, 7);
        const showYear = range.type === "all"; // если диапазон > одного года — показываем год в axis
        while (cur <= tail) {
            const ym = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
            let sum = 0;
            for (const [iso, v] of agg.byDate) if (iso.startsWith(ym)) sum += v;
            const m = cur.toLocaleString("ru-RU", { month: "short" }).replace(".", "");
            // Для «Всё время» label = "MM'YY" (например, "май 25") — год обязателен для понимания
            const label = showYear ? `${m} '${String(cur.getFullYear()).slice(2)}` : m;
            bins.push({ label, sum, isToday: ym === todayYM, full: ym });
            cur.setMonth(cur.getMonth() + 1);
        }
        title.textContent = "Тренд по месяцам";
    }

    const elapsedBins = Math.max(1, bins.filter(b => b.full <= todayStr.slice(0, b.full.length)).length);
    const avg = agg.total / elapsedBins;
    const max = bins.reduce((m, b) => Math.max(m, b.sum), 0) || 1;
    const maxBin = bins.reduce((mx, b) => b.sum > mx.sum ? b : mx, { sum: 0 });
    meta.textContent = `средн. ${fmt(Math.round(avg))} ${flag} · макс. ${fmt(Math.round(maxBin.sum))} ${flag}`;

    const CHART_H = 62; // px
    for (const b of bins) {
        const bar = document.createElement("div");
        bar.className = "stats-trend-bar" + (b.sum === 0 ? " zero" : "") + (b.isToday ? " today" : "");
        bar.title = `${b.label}: ${fmt(Math.round(b.sum))} ${state.baseCurrency}`;
        chart.appendChild(bar);
        const h = b.sum === 0 ? 2 : Math.max(2, (b.sum / max) * CHART_H);
        requestAnimationFrame(() => { bar.style.height = `${h.toFixed(1)}px`; });
    }
    const avgPct = (avg / max);
    if (avgPct > 0 && avgPct < 1) {
        const line = document.createElement("div");
        line.className = "stats-trend-avg";
        line.style.bottom = `${(avgPct * CHART_H + 4).toFixed(1)}px`;
        chart.appendChild(line);
    }

    // Ось X.
    // - week: 7 подписей (по одной на бар, помещается).
    // - month/year/all: разреженные тики с space-between, чтобы длинные label
    //   ("май '26") не зажимались узкой ячейкой бара.
    axis.innerHTML = "";
    axis.className = "stats-trend-axis";
    if (range.type === "week") {
        axis.classList.add("dense");
        for (const b of bins) {
            const sp = document.createElement("span");
            sp.textContent = b.label;
            if (b.isToday) sp.classList.add("today");
            axis.appendChild(sp);
        }
    } else {
        const n = bins.length;
        const tickCount = range.type === "month" ? 5 : Math.min(6, n);
        const picks = [];
        if (n === 1) {
            picks.push(0);
        } else {
            for (let i = 0; i < tickCount; i++) {
                picks.push(Math.round((n - 1) * (i / (tickCount - 1))));
            }
        }
        for (const idx of picks) {
            const sp = document.createElement("span");
            sp.textContent = bins[idx].label;
            axis.appendChild(sp);
        }
    }
}

function openCategoryDrilldown(catId) {
    const range = getStatsRange(state.statsPeriod.type, state.statsPeriod.offset);
    const items = state.expenses
        .filter(e => e.date >= range.from && e.date <= range.to && e.category_id === catId)
        .sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || "").localeCompare(a.created_at || ""));
    const cat = catOf(catId);
    $("#stats-detail-title").textContent = cat?.name || "—";
    const total = items.reduce((s, e) => {
        const c = convertToBase(e.amount, e.currency);
        return s + (c == null ? 0 : c);
    }, 0);
    const flag = flagOf(state.baseCurrency);
    $("#stats-detail-meta").textContent =
        `${range.label} · ${items.length} ${pluralRu(items.length, ["трата", "траты", "трат"])} · ${fmt(Math.round(total))} ${flag} ${state.baseCurrency}`;

    const ul = $("#stats-detail-list");
    ul.innerHTML = "";
    if (!items.length) {
        ul.innerHTML = `<p class="history-hint">Нет трат</p>`;
    } else {
        for (const e of items) {
            const li = document.createElement("li");
            const t = humanDayTitle(e.date);
            const row = document.createElement("div");
            row.className = "day-row";
            const titleHtml = e.note
                ? escapeHtml(e.note)
                : `<span style="color:var(--text-muted);font-weight:400;">Без описания</span>`;
            row.innerHTML = `
                <span class="icon" style="background:${cat?.color || "var(--bg-elevated)"}">${cat?.emoji || "📌"}</span>
                <div class="body">
                    <div class="name">${titleHtml}</div>
                    <div class="note">${escapeHtml(t.prefix)} · ${escapeHtml(t.weekday)}</div>
                </div>
                <span class="amount">${amountHTML(e.amount, e.currency)}</span>
            `;
            row.addEventListener("click", () => { closeModals(); setTimeout(() => openEditModal(e), 320); });
            li.appendChild(row);
            ul.appendChild(li);
        }
    }
    openModal("stats-detail");
}

// Если viewport ресайзится (rotate) — пересчитать transform
window.addEventListener("resize", () => snapTo(state.catPage, false));

init();
