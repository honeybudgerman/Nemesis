# NEMESIS: Rise of Two Kings

Персональная RPG-стратегия: реальные задания → опыт героя и ресурсы королевства, параллельно развивается соперник Каэль.

**Статус:** Sprint 1 — рабочая основа (авторизация, создание героя, Тронный зал, задания, XP/уровни, облачные сохранения, экспорт).

## Стек

Next.js 15 (App Router) · TypeScript strict · Tailwind CSS 4 · TanStack Query · Zustand · Supabase (Auth + PostgreSQL + RLS) · Vitest · PWA.

## Как устроена безопасность прогресса

- Клиент **никогда** не пишет в базу. Браузер использует Supabase только для входа и чтения своих данных (RLS).
- Все изменения идут через Route Handlers (`src/app/api/*`), которые проверяют сессию и вызывают транзакционные SQL-функции
  (`start_game`, `sync_quests`, `complete_quest`, `skip_quest`, `create_manual_quest`, `delete_game`).
  Эти функции может вызывать только `service_role`, ключ которого живёт только на сервере.
- `complete_quest` блокирует профиль (`FOR UPDATE`), проверяет ключ идемпотентности и уникальность завершения:
  повтор запроса или двойное нажатие не начисляют XP дважды. Своё задание ограничено 3 штуками и 60 XP в день.
- Все изменения ресурсов пишутся в `resource_ledger`, события — в `game_events`.
- Формулы XP (`src/engine/progression`) продублированы в SQL для атомарного пересчёта уровня; тест сверяет обе реализации.

## Подключение (один раз)

1. **Supabase.** В проекте откройте *Project Settings → API* и скопируйте `Project URL`, `anon public` и `service_role`.
2. **Переменные окружения.** Скопируйте `.env.example` в `.env.local` и заполните три значения Supabase.
   `SUPABASE_SERVICE_ROLE_KEY` — секрет: не коммитьте и не добавляйте префикс `NEXT_PUBLIC_`.
3. **Миграции.** Любой из способов:
   - Supabase CLI: `npx supabase login`, `npx supabase link --project-ref <ref>`, `npm run db:push`;
   - или вставьте содержимое `supabase/migrations/*.sql` (по порядку) в *SQL Editor* и выполните.
4. **Auth.** В *Authentication → URL Configuration* укажите `Site URL` (адрес приложения) и добавьте
   `https://<адрес>/auth/callback` в *Redirect URLs*. Для одного пользователя можно отключить подтверждение email
   (*Authentication → Providers → Email → Confirm email*).
5. **Запуск:** `npm install`, `npm run dev`, откройте http://localhost:3000.

### Деплой на Vercel

Импортируйте репозиторий в Vercel, добавьте те же три переменные в *Settings → Environment Variables* и задеплойте.
Адрес деплоя добавьте в настройки Auth Supabase (шаг 4).

## Проверки

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint
npm run test:unit   # движок: XP, уровни, оценки, планировщик заданий, часовые пояса
npm run build
```

Интеграционные тесты (`tests/integration`) прогоняют миграции на реальной PostgreSQL с заглушкой Supabase Auth и проверяют
идемпотентность, гонки, лимиты, истечение заданий и RLS:

```bash
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:integration
```

## Структура

```
src/app/            страницы (App Router) и API (Route Handlers)
src/engine/         игровые правила: progression (XP, уровни, награды), quests (планировщик)
src/server/         авторизация, Supabase-клиенты, сервисы, валидация (Zod), ошибки, rate limit
src/data/           шаблоны заданий, навыки, стартовые ресурсы, реплики Ориона
src/components/     UI, пиксельные спрайты
supabase/migrations схема БД, RLS, транзакционные функции
tests/              unit и integration
```

## Дальше

Sprint 2 — Каэль (независимый детерминированный симулятор, журнал, пропущенные дни) · Sprint 3 — Орион (AI Gateway через OpenRouter) ·
Sprint 4 — королевство и бои · Sprint 5 — двор · Sprint 6 — сюжет и полировка.
