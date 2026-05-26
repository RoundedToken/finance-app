import { useState } from "react";
import { useApp } from "@/store";
import { haptic } from "@/lib/telegram";

/**
 * Полноэкранный редактор описания. Единственное место с системной клавиатурой —
 * но layout заранее заложен под неё: header сверху + textarea flex-1 в контейнере
 * высотой = Telegram viewport. Клавиатура занимает низ, textarea сжимается, ничего
 * не прыгает (нет bottom-sheet, который выезжает). Редактирует draft.note.
 */
export function NoteScreen() {
    const { s, d } = useApp();
    const [text, setText] = useState(s.note);
    const back = s.editingId ? "edit" : "main";
    const save = () => { haptic("light"); d({ t: "note", v: text.trim() }); d({ t: "screen", v: back }); };
    const cancel = () => { haptic("light"); d({ t: "screen", v: back }); };

    return (
        <div className="flex flex-col" style={{ height: "var(--tg-viewport-height, 100dvh)" }}>
            <header className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
                <button onClick={cancel} className="text-hint text-sm py-1">Отмена</button>
                <span className="font-semibold">Описание</span>
                <button onClick={save} className="text-accent font-medium text-sm py-1">Готово</button>
            </header>
            <textarea
                autoFocus
                value={text}
                enterKeyHint="done"
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); } }}
                placeholder="Введите описание покупки"
                className="flex-1 w-full px-4 py-3 text-base bg-transparent outline-none resize-none"
            />
        </div>
    );
}
