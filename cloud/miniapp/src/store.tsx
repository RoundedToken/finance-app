import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import { todayISO, applyNumpadKey } from "@/lib/utils";
import type { Expense } from "@/api/types";

export type Screen = "main" | "history" | "stats" | "edit" | "note";
export type ModalName = "currency" | "date" | "account" | "menu" | "settings" | null;

export interface State {
    amount: string;            // строка суммы (numpad)
    currency: string;
    accountId: string | null;  // null = «без счёта»
    date: string;
    note: string;
    categoryId: string | null; // выбранная категория (для edit; на главной категорию задаёт тап-создание)
    editingId: string | null;  // id редактируемой траты (null = создание новой)
    screen: Screen;
    modal: ModalName;
    baseCurrency: string;
}

export type Action =
    | { t: "key"; k: string }            // numpad-клавиша
    | { t: "currency"; v: string }
    | { t: "account"; v: string | null }
    | { t: "date"; v: string }
    | { t: "note"; v: string }
    | { t: "category"; v: string | null }
    | { t: "resetDraft" }
    | { t: "loadEdit"; e: Expense }
    | { t: "screen"; v: Screen }
    | { t: "modal"; v: ModalName }
    | { t: "baseCurrency"; v: string };

const BASE_KEY = "mini.baseCurrency";
const ACC_KEY = "mini.lastAccount";

type Draft = Pick<State, "amount" | "currency" | "accountId" | "date" | "note" | "categoryId" | "editingId">;

function freshDraft(): Draft {
    return {
        amount: "0",
        currency: "RSD",
        accountId: localStorage.getItem(ACC_KEY) || null,
        date: todayISO(),
        note: "",
        categoryId: null,
        editingId: null,
    };
}

function init(): State {
    return { ...freshDraft(), screen: "main", modal: null, baseCurrency: localStorage.getItem(BASE_KEY) || "EUR" };
}

function reducer(s: State, a: Action): State {
    switch (a.t) {
        case "key": return { ...s, amount: applyNumpadKey(s.amount, a.k) };
        case "currency": return { ...s, currency: a.v, modal: null };
        case "account":
            if (a.v) localStorage.setItem(ACC_KEY, a.v); else localStorage.removeItem(ACC_KEY);
            return { ...s, accountId: a.v, modal: null };
        case "date": return { ...s, date: a.v, modal: null };
        case "note": return { ...s, note: a.v };
        case "category": return { ...s, categoryId: a.v };
        case "resetDraft": return { ...s, ...freshDraft() };
        case "loadEdit": {
            const e = a.e;
            return {
                ...s,
                amount: String(e.amount), currency: e.currency, accountId: e.account_id,
                date: e.date, note: e.note ?? "", categoryId: e.category_id, editingId: e.id,
                screen: "edit", modal: null,
            };
        }
        case "screen": return { ...s, screen: a.v, modal: null };
        case "modal": return { ...s, modal: a.v };
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

export function amountValue(s: State): number {
    return parseFloat(s.amount) || 0;
}
