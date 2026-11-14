"use client";

import Link from "next/link";

/** Shown instead of Next's blank "Application error" page when a server component fails. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <h1 className="font-pixel text-2xl text-gold">Что-то пошло не так</h1>
      <div className="pixel-panel w-full p-4 text-left text-sm text-text/85">
        <p>Сервер не смог загрузить данные королевства.</p>
        <p className="mt-2">
          Если проект только что настроен, проверьте, что миграция базы из <code>supabase/migrations/</code> выполнена в
          Supabase SQL Editor. Подробности ошибки есть в логах Vercel.
        </p>
        {error.digest && <p className="mt-2 font-mono text-xs text-muted">Код: {error.digest}</p>}
      </div>
      <div className="flex gap-2">
        <button className="pixel-btn pixel-btn-gold" onClick={() => reset()}>
          Повторить
        </button>
        <Link href="/" className="pixel-btn">
          На главную
        </Link>
      </div>
    </main>
  );
}
