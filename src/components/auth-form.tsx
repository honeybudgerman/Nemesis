"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { clearCachedState } from "@/hooks/use-game";
import { getBrowserSupabase } from "@/lib/supabase/browser";

const ERRORS: Record<string, string> = {
  "Invalid login credentials": "Неверный email или пароль.",
  "User already registered": "Такой пользователь уже зарегистрирован.",
  "Email not confirmed": "Email ещё не подтверждён — проверьте почту.",
};

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") ? "Не удалось подтвердить вход. Попробуйте ещё раз." : null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const supabase = getBrowserSupabase();
    try {
      if (mode === "register") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/start` },
        });
        if (error) throw error;
        if (!data.session) {
          setInfo("Мы отправили письмо для подтверждения. Откройте ссылку из письма, чтобы продолжить.");
          return;
        }
        clearCachedState();
        router.replace("/start");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        clearCachedState();
        const next = params.get("next");
        router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
      }
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(ERRORS[msg] ?? (msg || "Ошибка входа"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="pixel-panel pixel-panel-gold w-full p-5 sm:p-6">
      <h1 className="font-display text-2xl text-gold">{mode === "login" ? "Вход" : "Регистрация"}</h1>
      <label className="mt-4 block">
        <span className="text-sm text-muted">Email</span>
        <input className="pixel-input mt-1" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="mt-3 block">
        <span className="text-sm text-muted">Пароль</span>
        <input
          className="pixel-input mt-1"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === "register" && <span className="mt-1 block text-xs text-muted">Не меньше 8 символов.</span>}
      </label>
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      {info && <p className="mt-3 text-sm text-xp" role="status">{info}</p>}
      <button type="submit" className="pixel-btn pixel-btn-gold mt-5 w-full" disabled={busy}>
        {busy ? "Подождите…" : mode === "login" ? "Войти" : "Создать аккаунт"}
      </button>
      <p className="mt-4 text-center text-sm text-muted">
        {mode === "login" ? (
          <>Нет аккаунта? <Link className="text-gold underline" href="/register">Регистрация</Link></>
        ) : (
          <>Уже есть аккаунт? <Link className="text-gold underline" href="/login">Войти</Link></>
        )}
      </p>
    </form>
  );
}
