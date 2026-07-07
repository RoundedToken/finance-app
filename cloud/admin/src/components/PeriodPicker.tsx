import { ChevronLeft, ChevronRight, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * PeriodPicker — segmented control + prev/next nav для выбора временного
 * окна, как в Mini App (Stage 3). Один клик переключает диапазон,
 * стрелки сдвигают offset (предыдущий/следующий месяц или год).
 *
 * Diff vs Mini App:
 *  - кнопка «Период» открывает inline custom range (два <input type=date>)
 *  - default = месяц, offset=0 (текущий)
 */

export type PeriodType = "week" | "month" | "30d" | "year" | "all" | "custom";

export interface PeriodValue {
    type: PeriodType;
    offset: number;             // 0 = текущий; -1 = предыдущий; навигация только для month/year
    customFrom?: string;        // YYYY-MM-DD; используется при type="custom"
    customTo?: string;
}

export interface PeriodRange {
    type: PeriodType;
    from: string;               // YYYY-MM-DD inclusive (для "all" = "" — фильтр не нужен)
    to: string;                 // YYYY-MM-DD inclusive ("" для "all")
    label: string;
}

export const DEFAULT_PERIOD: PeriodValue = { type: "month", offset: 0 };

const MONTHS = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const MONTHS_GEN = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function pad(n: number): string { return String(n).padStart(2, "0"); }
function isoDate(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function startOfWeek(d: Date): Date {
    // Понедельник как первый день недели (RU/EU convention).
    const day = d.getDay() || 7; // Sunday → 7
    const r = new Date(d);
    r.setDate(d.getDate() - day + 1);
    r.setHours(0, 0, 0, 0);
    return r;
}

export function computeRange(value: PeriodValue): PeriodRange {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const t = value.type;

    if (t === "week") {
        const start = addDays(startOfWeek(today), value.offset * 7);
        const end = addDays(start, 6);
        const sameMonth = start.getMonth() === end.getMonth();
        const sameYear = start.getFullYear() === end.getFullYear();
        const label = sameMonth
            ? `${start.getDate()}–${end.getDate()} ${MONTHS_GEN[start.getMonth()]}${sameYear && start.getFullYear() === today.getFullYear() ? "" : ` ${end.getFullYear()}`}`
            : `${start.getDate()} ${MONTHS_GEN[start.getMonth()]} – ${end.getDate()} ${MONTHS_GEN[end.getMonth()]}${sameYear && start.getFullYear() === today.getFullYear() ? "" : ` ${end.getFullYear()}`}`;
        return { type: t, from: isoDate(start), to: isoDate(end), label };
    }

    if (t === "month") {
        // ADM-04: считаем от 1-го числа, не мутируем день. Прежний addMonths через
        // setMonth переполнялся 29–31 числа (31 мая − 1 мес → «31 апреля» → 1 мая):
        // ‹prev› возвращал тот же месяц, а offset −2 перескакивал через месяц.
        const ref = new Date(today.getFullYear(), today.getMonth() + value.offset, 1);
        const start = ref;
        const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
        const label = `${MONTHS[ref.getMonth()]} ${ref.getFullYear()}`;
        return { type: t, from: isoDate(start), to: isoDate(end), label };
    }

    if (t === "year") {
        const y = today.getFullYear() + value.offset;
        return { type: t, from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
    }

    if (t === "30d") {
        const start = addDays(today, -29);
        return { type: t, from: isoDate(start), to: isoDate(today), label: "Последние 30 дней" };
    }

    if (t === "custom") {
        const from = value.customFrom || isoDate(today);
        const to = value.customTo || isoDate(today);
        const label = from === to ? prettyDate(from) : `${prettyDate(from)} – ${prettyDate(to)}`;
        return { type: t, from, to, label };
    }

    // "all"
    return { type: "all", from: "", to: "", label: "Всё время" };
}

function prettyDate(iso: string): string {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y}`;
}

interface PeriodPickerProps {
    value: PeriodValue;
    onChange: (v: PeriodValue) => void;
    className?: string;
}

const TABS: { type: PeriodType; label: string }[] = [
    { type: "week",   label: "Нед" },
    { type: "month",  label: "Мес" },
    { type: "30d",    label: "30 дней" },
    { type: "year",   label: "Год" },
    { type: "all",    label: "Всё" },
    { type: "custom", label: "Период" },
];

export function PeriodPicker({ value, onChange, className }: PeriodPickerProps) {
    const range = computeRange(value);
    const canShiftPrev = value.type === "week" || value.type === "month" || value.type === "year";
    const canShiftNext = canShiftPrev && value.offset < 0;

    const setType = (type: PeriodType) => {
        if (type === value.type) return;
        // При переключении сбрасываем offset на текущий период.
        if (type === "custom") {
            onChange({
                type,
                offset: 0,
                customFrom: value.customFrom ?? isoDate(new Date()),
                customTo: value.customTo ?? isoDate(new Date()),
            });
            return;
        }
        onChange({ type, offset: 0 });
    };

    const shift = (delta: number) => {
        if (!canShiftPrev) return;
        const next = value.offset + delta;
        if (next > 0) return;        // не уходим в будущее
        onChange({ ...value, offset: next });
    };

    return (
        <div className={cn("space-y-2", className)}>
            <div className="grid grid-cols-[2.25rem_1fr_2.25rem] items-center gap-1.5">
                <button
                    type="button"
                    aria-label="Предыдущий период"
                    disabled={!canShiftPrev}
                    onClick={() => shift(-1)}
                    className="btn-icon disabled:opacity-30 disabled:pointer-events-none"
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-center text-sm font-semibold tabular-nums tracking-wide text-foreground/90">
                    {range.label}
                </span>
                <button
                    type="button"
                    aria-label="Следующий период"
                    disabled={!canShiftNext}
                    onClick={() => shift(+1)}
                    className="btn-icon disabled:opacity-30 disabled:pointer-events-none"
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
            </div>

            <div className="grid grid-cols-6 gap-1 p-1 bg-secondary/60 rounded-xl">
                {TABS.map(tab => {
                    const active = tab.type === value.type;
                    return (
                        <button
                            key={tab.type}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setType(tab.type)}
                            className={cn(
                                "py-1.5 px-2 rounded-lg text-xs font-medium transition-colors inline-flex items-center justify-center gap-1.5",
                                active
                                    ? "bg-primary text-primary-foreground shadow-sm"
                                    : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                            )}
                        >
                            {tab.type === "custom" && <CalendarRange className="h-3.5 w-3.5" />}
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {value.type === "custom" && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                    <label className="text-xs text-muted-foreground space-y-1">
                        <span className="block">С</span>
                        <input
                            type="date"
                            value={value.customFrom ?? ""}
                            max={value.customTo ?? undefined}
                            onChange={e => onChange({ ...value, customFrom: e.target.value })}
                            className="w-full px-3 py-1.5 rounded-lg border bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                    </label>
                    <label className="text-xs text-muted-foreground space-y-1">
                        <span className="block">По</span>
                        <input
                            type="date"
                            value={value.customTo ?? ""}
                            min={value.customFrom ?? undefined}
                            onChange={e => onChange({ ...value, customTo: e.target.value })}
                            className="w-full px-3 py-1.5 rounded-lg border bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                    </label>
                </div>
            )}
        </div>
    );
}
