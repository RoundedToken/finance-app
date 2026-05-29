import { AlertCircle, RefreshCw } from "lucide-react";

/** Явная ошибка загрузки списка/данных с кнопкой повтора. Используется на всех
 *  страницах вместо маскировки 5xx под empty-state «данных пока нет» (Фаза 1.2). */
export function ErrorState({ onRetry, label = "Не удалось загрузить данные" }: { onRetry: () => void; label?: string }) {
    return (
        <div className="card p-8 text-center space-y-3">
            <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
            <div className="font-medium">{label}</div>
            <button onClick={onRetry} className="btn-primary mx-auto"><RefreshCw className="h-4 w-4" /> Повторить</button>
        </div>
    );
}
