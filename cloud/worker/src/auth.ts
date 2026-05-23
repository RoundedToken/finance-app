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

    if (computedHex !== hash) return { ok: false, reason: "hash mismatch" };

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
    return h.slice(7) === expected;
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
