"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Portrait } from "@/components/characters/portrait";
import { EvaluationCard } from "@/components/quests/evaluation-card";
import { useOnline } from "@/hooks/use-online";
import { useGenerateQuests, useMentorChat, useMentorView } from "@/hooks/use-mentor";
import type { MentorView } from "@/types/game";

const QUICK = [
  { label: "Спросить совет", text: "Посмотри на мой прогресс и дай один конкретный совет на сегодня." },
  { label: "Пройти экзамен", text: "Проэкзаменуй меня: задай 3 коротких вопроса по навыку, который у меня сейчас слабее всего. Ответы я пришлю следующим сообщением." },
  { label: "Изучить новую тему", text: "Предложи новую тему для изучения на 15 минут с учётом моих навыков и объясни, с чего начать." },
];

export function MentorScreen() {
  const { data, error, isPending, refetch } = useMentorView();
  if (isPending) return <div className="py-16 text-center font-display text-muted">Орион зажигает свечи…</div>;
  if (!data) {
    return (
      <div className="pixel-panel p-6 text-center">
        <p className="text-danger">{error instanceof Error ? error.message : "Не удалось загрузить наставника."}</p>
        <button className="pixel-btn mt-4" onClick={() => refetch()}>
          Повторить
        </button>
      </div>
    );
  }
  return <MentorLayout v={data} />;
}

export function MentorLayout({ v }: { v: MentorView }) {
  const online = useOnline();
  const chat = useMentorChat();
  const generate = useGenerateQuests();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [v.messages.length, chat.isPending]);

  const send = (msg: string) => {
    const m = msg.trim();
    if (!m || chat.isPending) return;
    chat.mutate(m, { onSuccess: () => setText("") });
  };

  const aiReady = v.ai.configured;
  const limitReached = v.ai.todayRequests >= v.ai.dailyLimit || v.ai.monthCostUsd >= v.ai.monthlyBudgetUsd;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Chat */}
      <section className="pixel-panel flex flex-col self-start p-4 lg:col-span-2" aria-label="Беседа с Орионом">
        <div className="flex items-center gap-3">
          <Portrait kind="mentor" size={56} title="Орион" />
          <div>
            <h1 className="font-display text-2xl text-mana">Орион</h1>
            <p className="text-xs text-muted">
              {aiReady
                ? limitReached
                  ? "Лимит AI исчерпан: отвечаю заготовленными советами."
                  : "Наставник. Видит твой прогресс, но не выдумывает его."
                : "AI не подключён: отвечаю заготовленными советами."}
            </p>
          </div>
        </div>

        <div className="mt-3 grid max-h-[55vh] min-h-48 gap-2 overflow-y-auto pr-1" aria-live="polite">
          {v.messages.length === 0 && (
            <p className="text-sm text-muted">
              Задай вопрос об учёбе, трейдинге или дисциплине, {v.heroName}. Или выбери одно из действий ниже.
            </p>
          )}
          {v.messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] whitespace-pre-line border-2 px-3 py-2 text-sm ${
                m.role === "user" ? "ml-auto border-border bg-panel-2" : "border-mana/40 bg-bg-deep"
              }`}
            >
              {m.content}
              {m.source === "FALLBACK" && <div className="mt-1 text-[11px] text-muted">заготовленный ответ</div>}
            </div>
          ))}
          {chat.isPending && <div className="text-sm text-muted">Орион обдумывает ответ…</div>}
          <div ref={endRef} />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK.map((q) => (
            <button key={q.label} className="pixel-btn text-xs" disabled={!online || chat.isPending} onClick={() => send(q.text)}>
              {q.label}
            </button>
          ))}
        </div>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <textarea
            className="pixel-input min-h-12 flex-1"
            placeholder="Спросить Ориона…"
            maxLength={1500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
          />
          <button className="pixel-btn pixel-btn-gold self-end text-sm" disabled={!online || chat.isPending || !text.trim()}>
            Отправить
          </button>
        </form>
      </section>

      <div className="grid content-start gap-4">
        {/* Today's plan */}
        <section className="pixel-panel pixel-panel-gold p-4" aria-label="План на сегодня">
          <h2 className="font-display text-gold">План на сегодня</h2>
          {v.planToday === "exists" ? (
            <p className="mt-1 text-sm text-text/85">Орион уже составил задания на сегодня.</p>
          ) : v.planToday === "too_late" ? (
            <p className="mt-1 text-sm text-text/85">Ты уже начал закрывать задания дня. Новый план — завтра.</p>
          ) : (
            <p className="mt-1 text-sm text-text/85">
              Орион заменит сегодняшние задания на свои: 3 основных и 1 дополнительное с учётом твоих навыков. Награду считает игра.
            </p>
          )}
          <button
            className="pixel-btn pixel-btn-gold mt-3 w-full text-sm"
            disabled={!online || generate.isPending || v.planToday !== "available"}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? "Орион составляет план…" : "Получить задания"}
          </button>
          <Link href="/quests" className="mt-2 inline-block text-xs text-gold underline">
            К заданиям →
          </Link>
        </section>

        {/* Review quests */}
        {v.reviewQuests.length > 0 && (
          <section className="pixel-panel p-4" aria-label="Ждут проверки">
            <h2 className="font-display text-gold">Ждут проверки</h2>
            <ul className="mt-1 list-inside list-disc text-sm">
              {v.reviewQuests.map((q) => (
                <li key={q.id}>{q.title}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">Открой задание и нажми «Сдать ответ»: Орион поставит оценку, а XP начислит игра.</p>
          </section>
        )}

        {/* Evaluations */}
        <section className="pixel-panel p-4" aria-label="Оценки">
          <h2 className="font-display text-gold">Оценки</h2>
          {v.evaluations.length === 0 ? (
            <p className="mt-1 text-sm text-muted">Пока нет проверенных ответов.</p>
          ) : (
            v.evaluations.slice(0, 5).map((e) => <EvaluationCard key={e.id} evaluation={e} title />)
          )}
        </section>

        {/* Limits */}
        <section className="pixel-panel p-4 text-sm" aria-label="Лимиты AI">
          <h2 className="font-display text-gold">Лимиты AI</h2>
          <dl className="mt-1 grid gap-1">
            <div className="flex justify-between">
              <dt className="text-muted">Запросов сегодня</dt>
              <dd className="font-display">
                {v.ai.todayRequests} / {v.ai.dailyLimit}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Расход за месяц</dt>
              <dd className="font-display">
                ${v.ai.monthCostUsd.toFixed(3)} / ${v.ai.monthlyBudgetUsd.toFixed(2)}
              </dd>
            </div>
          </dl>
          <Link href="/settings" className="mt-2 inline-block text-xs text-gold underline">
            Изменить лимиты →
          </Link>
        </section>
      </div>
    </div>
  );
}
