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
    date: string;   // YYYY-MM-DD
    delta: number;  // native-валюта ведра: + приход, − расход
}

/**
 * Effective balance ведра (SPEC-011), семантика snapshot = «конец дня»:
 *
 *   balance = baselineAmount + Σ delta  где  baselineDate < event.date ≤ asOf
 *
 * События строго ПОСЛЕ даты baseline (`event.date > baselineDate`) — операции
 * того же дня, что и снапшот, считаются уже учтёнными в снапшоте (конец дня).
 * Чтобы скорректировать день снапшота — ставь дату следующего дня или новый
 * снапшот. Нет baseline → baselineAmount=0, baselineDate="0000-01-01".
 */
export function reconstructBalance(
    baselineAmount: number,
    baselineDate: string,
    events: LedgerEvent[],
    asOf: string,
): number {
    let bal = baselineAmount;
    for (const e of events) {
        if (e.date > baselineDate && e.date <= asOf) bal += e.delta;
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
