"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearCachedState } from "@/hooks/use-game";
import { useOnline } from "@/hooks/use-online";
import { apiFetch } from "@/lib/api-client";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { useUiStore } from "@/stores/ui-store";

export function SettingsView({ email }: { email: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const online = useOnline();
  const motionOff = useUiStore((s) => s.motionOff);
  const setMotionOff = useUiStore((s) => s.setMotionOff);
  const push = useUiStore((s) => s.pushToast);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function logout() {
    await getBrowserSupabase().auth.signOut();
    clearCachedState();
    qc.clear();
    router.replace("/login");
    router.refresh();
  }

  async function deleteProfile() {
    setBusy(true);
    try {
      await apiFetch("/api/game/profile", { method: "DELETE", json: { confirm } });
      clearCachedState();
      qc.clear();
      router.replace("/start");
      router.refresh();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Ошибка");
      setBusy(false);
    }
  }

  return (
    <div className="grid max-w-xl gap-4">
      <h1 className="font-display text-2xl text-gold">Настройки</h1>

      <section className="pixel-panel p-4">
        <h2 className="font-display text-gold">Аккаунт</h2>
        <p className="mt-1 text-sm text-muted">{email}</p>
        <p className="mt-1 text-sm text-text/85">
          Прогресс хранится в облаке: войдите с этим email на любом устройстве и продолжите с того же места.
        </p>
        <button className="pixel-btn mt-3 text-sm" onClick={logout}>
          Выйти
        </button>
      </section>

      <section className="pixel-panel p-4">
        <h2 className="font-display text-gold">Интерфейс</h2>
        <label className="mt-2 flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-[var(--gold)]" checked={motionOff} onChange={(e) => setMotionOff(e.target.checked)} />
          Отключить анимации
        </label>
      </section>

      <section className="pixel-panel p-4">
        <h2 className="font-display text-gold">Резервная копия</h2>
        <p className="mt-1 text-sm text-text/85">
          Скачайте весь прогресс в JSON: профиль, навыки, задания, историю и королевство. Пароли и ключи в файл не попадают.
        </p>
        <a className="pixel-btn mt-3 inline-block text-sm" href="/api/game/export" download>
          Скачать JSON
        </a>
      </section>

      <section className="pixel-panel border-danger p-4">
        <h2 className="font-display text-danger">Удалить игровой профиль</h2>
        <p className="mt-1 text-sm text-text/85">
          Герой, королевство, задания и вся история будут удалены без возможности восстановления. Сначала скачайте резервную
          копию. Чтобы подтвердить, введите слово <b>УДАЛИТЬ</b>.
        </p>
        <input className="pixel-input mt-3" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Подтверждение удаления" />
        <button className="pixel-btn mt-3 text-sm text-danger" disabled={confirm !== "УДАЛИТЬ" || busy || !online} onClick={deleteProfile}>
          {busy ? "Удаляю…" : "Удалить навсегда"}
        </button>
      </section>
    </div>
  );
}
