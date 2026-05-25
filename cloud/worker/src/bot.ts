/**
 * Telegram bot logic for Stage 1.
 * Минимальный текстовый bot для bootstrap и smoke-теста.
 */
import type { Env } from "./types";
import { isAuthorizedUser, createExpense } from "./db";

interface TelegramUpdate {
    message?: {
        message_id: number;
        chat: { id: number; type: string };
        from?: { id: number; first_name?: string; username?: string };
        text?: string;
        date: number;
    };
}

export async function handleTelegramUpdate(update: TelegramUpdate, env: Env): Promise<void> {
    const msg = update.message;
    if (!msg || !msg.text || !msg.from) return;

    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    const text = msg.text.trim();

    // SECURITY: бот полностью молчит для всех, кого нет в authorized_users.
    // Никакого приветствия, никакого "не авторизованы", никакого echo Telegram ID.
    // Только лог в Worker logs для аудита. Это намеренно — см. docs/decisions.md ADR-009.
    if (!(await isAuthorizedUser(env, userId))) {
        console.log(
            JSON.stringify({
                event: "unauthorized_attempt",
                user_id: userId,
                username: msg.from.username ?? null,
                first_name: msg.from.first_name ?? null,
                chat_id: chatId,
                text_preview: text.slice(0, 80),
            }),
        );
        return;
    }

    // С этого места — пользователь в whitelist. Отвечаем по-полной.
    if (text === "/start" || text === "/id") {
        const lines = [
            `👋 Привет, ${msg.from.first_name ?? "user"}!`,
            ``,
            `✅ Вы авторизованы.`,
            ``,
            `Откройте <b>Mini App</b> через кнопку <b>Finances</b> внизу чата.`,
            ``,
            `Команды (если Mini App не работает):`,
            `  /id — ваш ID`,
            `  <code>50 EUR food продукты</code> — записать трату`,
        ];
        await sendMessage(env, chatId, lines.join("\n"));
        return;
    }

    // /sync команда удалена — после D1-centric pivot статус не нужен.

    // Парсинг "<amount> <ccy> <category> [note]"
    const parsed = parseExpense(text);
    if (!parsed) {
        await sendMessage(
            env,
            chatId,
            `❓ Не понял. Формат: <code>50 EUR food продукты</code>\n(сумма валюта категория [заметка])`,
        );
        return;
    }

    // UUID v4 на стороне worker (для bootstrap fallback; Mini App будет генерить сам)
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const date = now.slice(0, 10);

    await createExpense(env, userId, {
        id,
        date,
        amount: parsed.amount,
        currency: parsed.currency,
        category_id: parsed.category,
        note: parsed.note ?? null,
        created_at: now,
        source: "telegram_bot",
    });

    await sendMessage(
        env,
        chatId,
        `✅ Записано: <b>${parsed.amount} ${parsed.currency}</b> / ${parsed.category}` +
            (parsed.note ? `\n📝 ${escapeHtml(parsed.note)}` : "") +
            `\n<i>id: ${id.slice(0, 8)}…</i>`,
    );
}

function parseExpense(text: string): { amount: number; currency: string; category: string; note?: string } | null {
    const m = text.match(/^(-?\d+(?:[.,]\d+)?)\s+([A-Za-z]{3,5})\s+(\S+)(?:\s+(.+))?$/);
    if (!m) return null;
    const amount = parseFloat(m[1].replace(",", "."));
    if (!isFinite(amount) || amount <= 0) return null;
    return {
        amount,
        currency: m[2].toUpperCase(),
        category: m[3].toLowerCase(),
        note: m[4]?.trim() || undefined,
    };
}

async function sendMessage(env: Env, chatId: number, text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
    };
    const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!r.ok) {
        console.error("sendMessage failed", await r.text());
    }
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
