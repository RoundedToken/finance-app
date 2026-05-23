// Mini App entry — Stage 0 заглушка.
// В Этапе 2 здесь будет полный UI ввода трат.

const tg = window.Telegram?.WebApp;
const status = document.getElementById("status");

function init() {
    if (!tg) {
        status.textContent = "❌ Не Telegram WebApp окружение";
        return;
    }
    tg.ready();
    tg.expand();
    const user = tg.initDataUnsafe?.user;
    status.textContent = user
        ? `привет, ${user.first_name} (#${user.id})`
        : "не удалось определить пользователя";

    // TODO Stage 2: bootstrap справочников из /v1/bootstrap, рендер сетки категорий
    document.getElementById("screen-onboarding").hidden = false;
}

init();
