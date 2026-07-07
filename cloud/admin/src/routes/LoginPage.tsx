import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getToken, isExpired } from "@/lib/auth";
import { googleLoginUrl } from "@/api/client";

export function LoginPage() {
    const navigate = useNavigate();

    useEffect(() => {
        const token = getToken();
        if (token && !isExpired(token)) navigate({ to: "/" });
    }, [navigate]);

    const handleLogin = () => {
        // ADM-03 (SPEC-044): возвращаем не на «/», а на страницу, с которой выкинуло
        // (сохранена в sessionStorage при показе модала / beforeLoad-redirect'е).
        // Сервер валидирует только origin (isAllowedReturnTo) — path проходит как есть.
        let returnPath = "/";
        try {
            const saved = sessionStorage.getItem("admin.return_to");
            if (saved && saved.startsWith("/")) returnPath = saved;
        } catch { /* ignore */ }
        window.location.href = googleLoginUrl(window.location.origin + returnPath);
    };

    return (
        <div className="min-h-full grid place-items-center p-4">
            <div className="card max-w-sm w-full p-8 text-center space-y-6 animate-slide-up">
                <div>
                    <div className="mx-auto h-14 w-14 rounded-2xl bg-primary text-primary-foreground grid place-items-center font-bold text-3xl">€</div>
                </div>
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Finances</h1>
                    <p className="text-sm text-muted-foreground mt-1">Личная финансовая админка</p>
                </div>
                <button onClick={handleLogin} className="btn-primary w-full py-3">
                    <GoogleIcon /> Войти через Google
                </button>
                <p className="text-xs text-muted-foreground">
                    Доступ ограничен: только владелец.
                </p>
            </div>
        </div>
    );
}

function GoogleIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="#fff" d="M21.6 12.227c0-.685-.061-1.345-.176-1.978H12v3.747h5.388c-.232 1.249-.937 2.307-1.997 3.015v2.508h3.232c1.892-1.742 2.977-4.307 2.977-7.292z"/>
            <path fill="#fff" d="M12 22c2.7 0 4.964-.895 6.619-2.42l-3.232-2.508c-.896.6-2.042.957-3.387.957-2.605 0-4.81-1.76-5.598-4.124H3.064v2.59C4.71 19.778 8.099 22 12 22z"/>
            <path fill="#fff" d="M6.402 13.905A6.013 6.013 0 0 1 6.08 12c0-.66.114-1.302.323-1.905V7.505H3.064A9.997 9.997 0 0 0 2 12c0 1.614.386 3.14 1.064 4.495l3.338-2.59z"/>
            <path fill="#fff" d="M12 5.97c1.47 0 2.79.506 3.826 1.498l2.866-2.866C16.964 2.99 14.7 2 12 2 8.099 2 4.71 4.222 3.064 7.505l3.338 2.59C7.19 7.73 9.395 5.97 12 5.97z"/>
        </svg>
    );
}
