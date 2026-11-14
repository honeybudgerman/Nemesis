import Link from "next/link";
import { redirect } from "next/navigation";
import { Portrait } from "@/components/characters/portrait";
import { isSupabaseConfigured, missingSupabaseEnv } from "@/lib/env";
import { createUserSupabase } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const configured = isSupabaseConfigured();
  if (configured) {
    const db = await createUserSupabase();
    const { data } = await db.auth.getUser();
    if (data.user) redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <div className="flex items-end gap-6">
        <Portrait kind="hero" size={72} title="Герой" />
        <span className="font-pixel text-2xl text-muted pb-6">vs</span>
        <Portrait kind="rival" size={72} title="Каэль Валькарион" />
      </div>
      <div>
        <h1 className="font-pixel text-4xl text-gold tracking-widest sm:text-5xl">NEMESIS</h1>
        <p className="font-pixel mt-1 text-muted">Восхождение двух королей</p>
      </div>
      <p className="text-text/85">
        Реальные дела — реальная сила. Выполняй задания в жизни, развивай героя и королевство и соревнуйся с Каэлем,
        который растёт по собственным правилам.
      </p>
      {configured ? (
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/register" className="pixel-btn pixel-btn-gold text-center">
            Начать путь
          </Link>
          <Link href="/login" className="pixel-btn text-center">
            Войти
          </Link>
        </div>
      ) : (
        <div className="pixel-panel w-full p-4 text-left text-sm">
          <div className="font-pixel text-danger">Сервер не настроен</div>
          <p className="mt-1 text-text/85">
            Задайте переменные окружения Supabase из <code>.env.example</code> и перезапустите приложение.
          </p>
          <p className="mt-2 text-text/85">Не найдены:</p>
          <ul className="mt-1 list-inside list-disc font-mono text-xs text-danger">
            {missingSupabaseEnv().map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
