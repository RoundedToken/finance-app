/**
 * Цвета графиков из текущей темы (HSL-vars в styles.css). Читаем через
 * getComputedStyle на каждый вызов → переживает переключение light/dark.
 * Общий для DashboardPage (ECharts) и Sparkline (SPEC-021).
 */
export function chartTheme() {
    const cs = getComputedStyle(document.documentElement);
    const hsl = (name: string) => {
        const parts = cs.getPropertyValue(name).trim().split(/\s+/);
        return parts.length >= 3 ? `hsl(${parts[0]}, ${parts[1]}, ${parts[2]})` : parts.join(" ");
    };
    return {
        fg: hsl("--foreground"), muted: hsl("--muted-foreground"), border: hsl("--border"),
        positive: hsl("--positive"), negative: hsl("--negative"),
    };
}
