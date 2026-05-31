import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

/**
 * Мини-тренд без осей/тултипа — «искра» из готового ряда значений.
 * Переиспользуется KPI-карточками дашборда (SPEC-013/015) и карточками
 * вёдер на /accounts (SPEC-021).
 *
 * inProgressTail — сколько последних точек считать «неполными» (пунктир):
 * для потоков (Траты/Доход/Норма) последний месяц = текущий, ещё копится.
 * Пунктир здесь = «происходит сейчас, к этому идём» (согласовано 2026-05-28).
 * На большом графике Net worth пунктир означает forecast — разные контексты,
 * не путать. Для стоков (баланс ведра, net worth) inProgressTail=0 — сплошная.
 */
export function Sparkline({
    values,
    color,
    inProgressTail = 0,
    height = 34,
}: {
    values: number[];
    color: string;
    inProgressTail?: number;
    height?: number;
}) {
    if (values.length < 2) return null;
    // values без Math.round — дробные KPI (норма) иначе теряют вариацию (0.27 → 0).
    const last = values.length - 1;
    const cut = Math.max(0, last - inProgressTail);
    const fullData = values.map((v, i) => (i <= cut ? v : null));
    const tailData = values.map((v, i) => (i >= cut ? v : null));
    const option: EChartsOption = {
        backgroundColor: "transparent",
        grid: { left: 2, right: 2, top: 3, bottom: 3 },
        xAxis: { type: "category", show: false, data: values.map((_, i) => i) },
        yAxis: { type: "value", show: false, scale: true },
        tooltip: { show: false },
        series: inProgressTail > 0 ? [
            { type: "line", data: fullData, showSymbol: false, smooth: true,
              lineStyle: { width: 1.5, color }, areaStyle: { opacity: 0.1, color } },
            { type: "line", data: tailData, showSymbol: false, smooth: true,
              lineStyle: { width: 1.5, color, type: "dashed" }, areaStyle: { opacity: 0.04, color } },
        ] : [
            { type: "line", data: values, showSymbol: false, smooth: true,
              lineStyle: { width: 1.5, color }, areaStyle: { opacity: 0.1, color } },
        ],
    };
    // aria-hidden — искра декоративна: число (баланс / KPI) и так на карточке текстом.
    return (
        <div aria-hidden="true">
            <ReactECharts option={option} style={{ height, width: "100%" }} notMerge />
        </div>
    );
}
