/**
 * Authorization helpers:
 *  - Telegram Mini App initData validation (HMAC-SHA256)
 *  - Bearer token validation (for MacBook -> Worker calls)
 */

export interface InitDataResult {
    ok: boolean;
    user_id?: string;
    username?: string;
    reason?: string;
}

/** SEC-07 (волна 2): сравнение секрет-производных строк без раннего выхода
 *  (XOR-аккумулятор — работает и в Workers, и в node-тестах). Ранний return
 *  по длине допустим (длина не секретна). */
export function timingSafeEqualStr(a: string, b: string): boolean {
    const enc = new TextEncoder();
    const ab = enc.encode(a);
    const bb = enc.encode(b);
    if (ab.byteLength !== bb.byteLength) return false;
    let diff = 0;
    for (let i = 0; i < ab.byteLength; i++) diff |= ab[i] ^ bb[i];
    return diff === 0;
}

/** SEC-06 (волна 2): свежесть initData. Подпись Telegram не истекает сама — без TTL
 *  утёкшая строка initData давала бы бессрочный доступ. 24ч покрывает долгоживущий
 *  WebView-сеанс; auth_date уже входит в подпись, протокол не меняется. */
const INIT_DATA_TTL_SECONDS = 24 * 60 * 60;

/**
 * Validates Telegram WebApp initData per:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export async function validateInitData(
    initData: string,
    botToken: string,
): Promise<InitDataResult> {
    if (!initData) return { ok: false, reason: "missing initData" };

    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { ok: false, reason: "missing hash" };
    params.delete("hash");

    const pairs: string[] = [];
    for (const [k, v] of [...params.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        pairs.push(`${k}=${v}`);
    }
    const dataCheckString = pairs.join("\n");

    const secretKey = await hmacSha256(
        new TextEncoder().encode("WebAppData"),
        new TextEncoder().encode(botToken),
    );
    const computed = await hmacSha256(
        secretKey,
        new TextEncoder().encode(dataCheckString),
    );
    const computedHex = bufferToHex(computed);

    if (!timingSafeEqualStr(computedHex, hash)) return { ok: false, reason: "hash mismatch" };

    // SEC-06: replay-окно. auth_date подписан → подделать нельзя, только реиграть.
    const authDate = Number(params.get("auth_date"));
    if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: "missing auth_date" };
    if (Math.floor(Date.now() / 1000) - authDate > INIT_DATA_TTL_SECONDS) {
        return { ok: false, reason: "initData expired" };
    }

    const userRaw = params.get("user");
    if (!userRaw) return { ok: false, reason: "no user" };
    try {
        const user = JSON.parse(userRaw);
        return { ok: true, user_id: String(user.id), username: user.username };
    } catch {
        return { ok: false, reason: "bad user json" };
    }
}

export function checkBearer(request: Request, expected: string): boolean {
    const h = request.headers.get("Authorization");
    if (!h || !h.startsWith("Bearer ")) return false;
    return timingSafeEqualStr(h.slice(7), expected);   // SEC-07
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: Uint8Array): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        key,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    return await crypto.subtle.sign("HMAC", cryptoKey, data);
}

function bufferToHex(buffer: ArrayBuffer): string {
    return [...new Uint8Array(buffer)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
