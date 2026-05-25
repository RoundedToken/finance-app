import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import { todayISO } from "@/lib/utils";
import type { Expense } from "@/api/types";

export type Screen = "main" | "history" | "stats";
export type ModalName = "currency" | "date" | "note" | "account" | "menu" | "settings" | "edit" | null;

export interface State {
    amount: string;            // строка ввода numpad ("0", "12.5")
    currency: string;
    accountId: string | null;  // null = «без счёта» (SPEC-014)
    date: string;              // YYYY-MM-DD
    note: string;
    screen: Screen;
    modal: ModalName;
    editing: Expense | null;   // редактируемая трата (modal "edit")
    baseCurrency: string;      // для аналитики (Фаза 2), localStorage
}

export type Action =
    | { t: "digit"; d: string }
    | { t: "dot" }
    | { t: "back" }
    | { t: "currency"; v: string }
    | { t: "account"; v: string | null }
    | { t: "date"; v: string }
    | { t: "note"; v: string }
    | { t: "resetDraft" }
    | { t: "screen"; v: Screen }
    | { t: "modal"; v: ModalName }
    | { t: "edit"; e: Expense | null }
    | { t: "baseCurrency"; v: string };

const BASE_KEY = "mini.baseCurrency";
const ACC_KEY = "mini.lastAccount";
const MAX_DIGITS = 12;

function init(): State {
    return {
        amount: "0",
        currency: "RSD",
        accountId: localStorage.getItem(ACC_KEY) || null,   // запоминаем последний счёт
        date: todayISO(),
        note: "",
        screen: "main",
        modal: null,
        editing: null,
        baseCurrency: localStorage.getItem(BASE_KEY) || "EUR",
    };
}

function reducer(s: State, a: Action): State {
    switch (a.t) {
        case "digit": {
            const next = s.amount === "0" ? a.d : s.amount + a.d;
            if (next.replace(".", "").length > MAX_DIGITS) return s;
            const dec = next.split(".")[1];
            if (dec && dec.length > 2) return s;
            return { ...s, amount: next };
        }
        case "dot":
            return s.amount.includes(".") ? s : { ...s, amount: s.amount + "." };
        case "back": {
            const n = s.amount.slice(0, -1);
            return { ...s, amount: n === "" ? "0" : n };
        }
        case "currency": return { ...s, currency: a.v, modal: null };
        case "account":
            if (a.v) localStorage.setItem(ACC_KEY, a.v); else localStorage.removeItem(ACC_KEY);
            return { ...s, accountId: a.v, modal: null };
        case "date": return { ...s, date: a.v, modal: null };
        case "note": return { ...s, note: a.v };
        case "resetDraft": return { ...s, amount: "0", note: "", date: todayISO() };
        case "screen": return { ...s, screen: a.v, modal: null };
        case "modal": return { ...s, modal: a.v };
        case "edit": return { ...s, editing: a.e, modal: a.e ? "edit" : null };
        case "baseCurrency": localStorage.setItem(BASE_KEY, a.v); return { ...s, baseCurrency: a.v };
    }
}

const Ctx = createContext<{ s: State; d: Dispatch<Action> } | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
    const [s, d] = useReducer(reducer, undefined, init);
    return <Ctx.Provider value={{ s, d }}>{children}</Ctx.Provider>;
}

export function useApp() {
    const c = useContext(Ctx);
    if (!c) throw new Error("AppProvider missing");
    return c;
}

/** Числовое значение текущего ввода. */
export function amountValue(s: State): number {
    return parseFloat(s.amount) || 0;
}
