/**
 * Общие тест-хелперы (SPEC-046). makeInitData вынесен из
 * spec-045-auth-hardening.test.ts — переиспользуется e2e-тестами периметра
 * Mini App (QA-04): initData подписывается тем же HMAC-алгоритмом, что у
 * Telegram, на фейковом bot token — оффлайн, секретов не требует.
 */

export const BOT_TOKEN = "12345:test-bot-token";

/** Собирает подписанный initData тем же алгоритмом, что Telegram (для тестов). */
export async function makeInitData(authDate: number, userId = 42, botToken = BOT_TOKEN): Promise<string> {
    const params = new URLSearchParams();
    params.set("auth_date", String(authDate));
    params.set("query_id", "AAtest");
    params.set("user", JSON.stringify({ id: userId, username: "tester" }));
    const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`);
    const dataCheckString = pairs.join("\n");
    const enc = new TextEncoder();
    const secretKey = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const secret = await crypto.subtle.sign("HMAC", secretKey, enc.encode(botToken));
    const dataKey = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", dataKey, enc.encode(dataCheckString));
    const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
    params.set("hash", hex);
    return params.toString();
}
