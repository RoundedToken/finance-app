import { cn } from "@/lib/utils";

/**
 * PeriodPresets — пресеты временного окна (12м/6м/Год/Всё/Период) для серверного
 * диапазона `from/to`. Общий контрол дашборда и инвестиций (SPEC-029) — единый вид
 * и поведение. Для списочной фильтрации с offset-навигацией см. отдельный PeriodPicker.
 */

// Date helpers (local time, YYYY-MM-DD).
export const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => iso(new Date());
export function startOfMonthMinus(monthsBack: number): string {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - monthsBack);
    return iso(d);
}

export type Preset = "auto" | "12m" | "6m" | "year" | "all" | "custom";
const PRESETS: { key: Preset; label: string }[] = [
    { key: "12m", label: "12 мес" },
    { key: "6m", label: "6 мес" },
    { key: "year", label: "Год" },
    { key: "all", label: "Всё" },
    { key: "custom", label: "Период" },
];
// SPEC-030: набор с «Авто» (серверное окно от первой операции) — для инвестиций.
export const PRESETS_WITH_AUTO: { key: Preset; label: string }[] = [
    { key: "auto", label: "Авто" }, ...PRESETS,
];

/** Пресет → серверный диапазон {from?, to?} (YYYY-MM-DD). cf/ct — custom from/to. */
export function presetRange(p: Preset, cf: string, ct: string): { from?: string; to?: string } {
    const today = todayIso();
    switch (p) {
        case "auto": return {};   // SPEC-030: без from/to → сервер берёт окно от первой операции
        case "12m": return { from: startOfMonthMinus(11), to: today };
        case "6m": return { from: startOfMonthMinus(5), to: today };
        case "year": return { from: `${new Date().getFullYear()}-01-01`, to: today };
        case "all": return { from: "2000-01-01", to: today };
        case "custom": return { from: cf || undefined, to: ct || today };
    }
}

export function PeriodPresets({ preset, setPreset, cf, ct, setCf, setCt, presets = PRESETS }: {
    preset: Preset; setPreset: (p: Preset) => void; cf: string; ct: string; setCf: (s: string) => void; setCt: (s: string) => void;
    presets?: { key: Preset; label: string }[];
}) {
    return (
        <div className="flex flex-col items-end gap-2">
            <div className="inline-flex gap-1 p-1 bg-secondary/60 rounded-xl">
                {presets.map(p => (
                    <button key={p.key} type="button" aria-pressed={preset === p.key} onClick={() => setPreset(p.key)}
                        className={cn("py-1.5 px-3 rounded-lg text-xs font-medium transition-colors",
                            preset === p.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground")}>
                        {p.label}
                    </button>
                ))}
            </div>
            {preset === "custom" && (
                <div className="flex items-center gap-2">
                    <input type="date" value={cf} max={ct} onChange={e => setCf(e.target.value)}
                        className="px-2 py-1 rounded-lg border bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring" />
                    <span className="text-muted-foreground text-sm">–</span>
                    <input type="date" value={ct} min={cf} max={todayIso()} onChange={e => setCt(e.target.value)}
                        className="px-2 py-1 rounded-lg border bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
            )}
        </div>
    );
}
