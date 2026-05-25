import { useGoals } from "@/api/queries";
import { Select } from "./Select";

interface GoalSelectorProps {
    value: string;
    onChange: (v: string) => void;
    fullWidth?: boolean;
    /** Если true — показывает только active goals. По умолчанию all (чтобы при
     *  редактировании ссылки на достигнутую/архивную цель опция не «исчезала»). */
    activeOnly?: boolean;
    "aria-label"?: string;
}

export function GoalSelector({ value, onChange, fullWidth = true, activeOnly = false, ...rest }: GoalSelectorProps) {
    const { data } = useGoals(activeOnly ? "active" : "all");
    const goals = data?.goals ?? [];
    return (
        <Select fullWidth={fullWidth} value={value} onChange={e => onChange(e.target.value)} aria-label={rest["aria-label"] ?? "Цель"}>
            <option value="">— не привязано —</option>
            {goals.map(g => (
                <option key={g.id} value={g.id}>
                    {g.emoji ?? "🎯"} {g.name}{g.status !== "active" ? ` · ${g.status === "achieved" ? "достигнута" : "архив"}` : ""}
                </option>
            ))}
        </Select>
    );
}
