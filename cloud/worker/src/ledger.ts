/**
 * Чистая (без D1) денежная математика — выделена для unit-тестов (vitest) и
 * чтобы snapshots.ts:getEffectiveBalance и dashboard.ts:balanceAt не разъезжались
 * в формуле баланса (SPEC-011).
 *
 * См. ADR-014 (конверсия валют), ADR-015 (REAL-деньги + округление).
 */

/** Денежное округление: убирает float-дребезг (387320.0000001), 8 знаков
 *  (безопасно для крипты с 8 decimals и фиата с 2). ADR-015. */
export function roundMoney(x: number): number {
    return Math.round(x * 1e8) / 1e8;
}

export interface LedgerEvent {
    date: string;        // YYYY-MM-DD — экономическая дата операции (может быть backdated)
    createdAt: string;   // YYYY-MM-DD HH:MM:SS (UTC) — время записи, tie-break внутри дня
    delta: number;       // native-валюта ведра: + приход, − расход
}

/**
 * Канонизирует timestamp к 'YYYY-MM-DD HH:MM:SS' (как datetime('now')): отрезает
 * мс/`Z` и меняет ISO-разделитель 'T' на пробел. Нужно, чтобы строковое сравнение
 * created_at между таблицами было корректным (' ' 0x20 < 'T' 0x54 иначе ломает
 * порядок). Момент времени не меняется (UTC→UTC). SPEC-024.
 */
export function canonicalTs(s: string): string {
    return s.includes("T") ? s.slice(0, 19).replace("T", " ") : s;
}

/**
 * Effective balance ведра (SPEC-011, уточнено SPEC-024): порядок событий
 * относительно снапшота внутри одного дня решается по времени записи (created_at):
 *
 *   balance = baselineAmount + Σ delta  где  event.date ≤ asOf  И
 *     ( event.date > baselineDate  ИЛИ
 *       (event.date == baselineDate И event.createdAt > baselineCreatedAt) )
 *
 * Дата операции — главный ключ (backdating сохраняется: событие за прошлую неделю
 * остаётся за прошлой неделей). created_at решает ТОЛЬКО ничью при равной дате —
 * «событие, записанное после снапшота того же дня, учитывается». Нет baseline →
 * baselineAmount=0, baselineDate="0000-01-01", baselineCreatedAt="" (created_at-ветка
 * не срабатывает, т.к. реальных событий с date="0000-01-01" нет).
 */
export function reconstructBalance(
    baselineAmount: number,
    baselineDate: string,
    baselineCreatedAt: string,
    events: LedgerEvent[],
    asOf: string,
): number {
    let bal = baselineAmount;
    for (const e of events) {
        if (e.date > asOf) continue;
        const afterBaseline =
            e.date > baselineDate ||
            (e.date === baselineDate && e.createdAt > baselineCreatedAt);
        if (afterBaseline) bal += e.delta;
    }
    return roundMoney(bal);
}

export interface TxFeeShape {
    from_account_id: string;
    to_account_id: string;
    from_currency: string;
    to_currency: string;
    fee_currency: string | null;
    fee_amount: number | null;
}

/**
 * Какое ведро платит комиссию транзакции (L2). Комиссия — дополнительный отток
 * в `fee_currency`. Правило: платит ведро, чья валюта совпадает с `fee_currency`,
 * приоритет — `from_account` (плательщик операции). Если `fee_currency` не
 * совпадает ни с from, ни с to (комиссия в третьей валюте) — не атрибутируется
 * ни одному ведру (редкий кейс, осознанно не вычитается; см. data-model.md).
 *
 * Возвращает id ведра-плательщика или null.
 */
export function feePayerBucket(tx: TxFeeShape): string | null {
    if (tx.fee_amount == null || tx.fee_amount <= 0 || !tx.fee_currency) return null;
    if (tx.fee_currency === tx.from_currency) return tx.from_account_id;
    if (tx.fee_currency === tx.to_currency) return tx.to_account_id;
    return null;
}
