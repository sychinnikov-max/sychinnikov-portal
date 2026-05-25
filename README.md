# sychinnikov.com

Приватный портал Андрея Сычинникова. Рабочая поверхность к second-brain (репозиторий `Claude-Context/`). Статический HTML, деплой через Cloudflare Pages.

## Структура (2026-05-21, пересборка)

```
/
├─ index.html               # Главная — дашборд (задачи / FT-Гантт / финансы / звонки / решения)
├─ assets/
│  ├─ css/portal.css        # Shared design system (paper-фон, navy-акцент, Source Serif 4 + Inter)
│  └─ js/portal.js          # Reveal + nav active + magnetic CTA
├─ founder-trajectory/      # Продукт: 5 ступеней pricing, методология 8 контуров, 3 фазы Reset
├─ clients/                 # Активные проекты: Fishok (retainer), Octo (пауза)
├─ contacts/                # Картотека с relationship-логикой — НОВЫЙ раздел
├─ finance/                 # План-факт май 2026, кошельки, фонды, кредит РФ, поездка США
├─ system/                  # AndreiOS: 4 субагента, slash-команды, правила, kill-switch
├─ decisions/               # ADR-журнал решений (сверху-новые)
├─ wisdom/                  # Источники мышления: Маргулан, Колесников, школа FT
├─ landing/                 # 3 варианта лендинга — hand/architect/system
├─ archive/                 # Архив + legacy-2026-05-21 (старые разделы)
├─ llms.txt                 # Карта портала для AI-агентов
├─ robots.txt, sitemap.xml
└─ README.md (этот файл)
```

## Деплой

Любой push в `main` обновляет сайт через Cloudflare Pages. Никакого билда — статика.

## Принципы

- **Приватный по дефолту.** Sychinnikov.com — закрытый личный портал, не публичный сайт. Если что-то нужно показать наружу — отдельный деплой на отдельном домене.
- **Главная = рабочая поверхность.** Не презентация. Один-два экрана с актуальным состоянием задач, продукта, финансов, звонков, решений.
- **Источник правды — `Claude-Context/`.** Этот сайт рендерит снимок состояния второго мозга. Не редактор.
- **Без сборщиков.** Чистый HTML/CSS/JS. Один shared CSS + один shared JS. Все страницы независимы.
- **Стиль один.** Тёплый paper-фон #FAFAF7, navy-акцент #1F3A5F, Source Serif 4 + Inter. Взят из `founder-trajectory/website/prototype/` (первый прототип лендинга FT).

## Что архивировано

В `archive/legacy-2026-05-21/` лежит предыдущая версия портала: `articles/`, `how-it-works/`, `health/`, `structure/`, `practice/`, `octo-project/`, `dashboard/`, `goals/`, `toolbox/`, `index-old.html`. Восстановить можно — все файлы целы.

## Контакт

Email: sychinnikov@gmail.com
