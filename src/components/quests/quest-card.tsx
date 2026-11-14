"use client";

import { useState } from "react";
import { SKILL_ICONS, SKILL_LABELS, isSkillCode } from "@/data/skills";
import { useCompleteQuest, useSkipQuest } from "@/hooks/use-game";
import { useOnline } from "@/hooks/use-online";
import { useStartedQuests } from "@/stores/started-quests";
import type { QuestView } from "@/types/game";

const STATUS_LABEL: Record<QuestView["status"], string> = {
  PENDING: "Ожидает",
  COMPLETED: "Выполнено",
  SKIPPED: "Пропущено",
  EXPIRED: "Истекло",
};

const STATUS_STYLE: Record<QuestView["status"], string> = {
  PENDING: "text-muted",
  COMPLETED: "text-xp",
  SKIPPED: "text-muted line-through",
  EXPIRED: "text-danger",
};

export function QuestCard({ quest, compact = false }: { quest: QuestView; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const online = useOnline();
  const complete = useCompleteQuest();
  const skip = useSkipQuest();
  const startedAt = useStartedQuests((s) => s.started[quest.id]);
  const start = useStartedQuests((s) => s.start);

  const pending = quest.status === "PENDING";
  const busy = complete.isPending || skip.isPending;
  const cat = isSkillCode(quest.category) ? quest.category : null;
  const done = quest.status === "COMPLETED";

  return (
    <article className={`pixel-panel p-3 sm:p-4 ${done ? "opacity-80" : ""}`}>
      <div className="flex items-start gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center border-2 text-xl ${done ? "border-xp bg-xp-dim" : "border-border bg-bg-deep"}`}
          aria-hidden
        >
          {done ? "✓" : cat ? SKILL_ICONS[cat] : "★"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="font-display text-base text-text">{quest.title}</h3>
            {quest.isOptional && <span className="text-xs text-mana">необязательно</span>}
            {quest.source === "MANUAL" && <span className="text-xs text-gold-dim">своё</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
            <span>{cat ? SKILL_LABELS[cat] : quest.category}</span>
            <span>⏱ {quest.estimatedMinutes} мин</span>
            <span className="text-xp">+{quest.baseXp} XP</span>
            <span className={STATUS_STYLE[quest.status]}>{STATUS_LABEL[quest.status]}</span>
            {startedAt && pending && <span className="text-gold">в процессе</span>}
          </div>
          {!compact && <p className="mt-2 text-sm text-text/85">{quest.description}</p>}
        </div>
      </div>

      {open && (
        <div className="mt-3 border-t-2 border-border pt-3 text-sm">
          {compact && <p className="mb-2 text-text/85">{quest.description}</p>}
          {quest.successCriteria.length > 0 && (
            <>
              <div className="font-display text-xs text-gold">Критерии выполнения</div>
              <ul className="mt-1 list-inside list-disc text-text/85">
                {quest.successCriteria.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-2 text-xs text-muted">
            Срок: {new Date(quest.deadlineAt).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })}
            {quest.grade && <> · Оценка: {quest.grade}</>}
          </div>
          {pending && (
            <label className="mt-3 block">
              <span className="text-xs text-muted">Заметка о выполнении (необязательно)</span>
              <textarea
                className="pixel-input mt-1 min-h-16"
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {pending && !startedAt && (
          <button className="pixel-btn text-sm" onClick={() => start(quest.id)} disabled={busy}>
            Начать
          </button>
        )}
        {pending && (
          <button
            className="pixel-btn pixel-btn-gold text-sm"
            disabled={!online || busy}
            onClick={() => complete.mutate({ questId: quest.id, note: note || undefined })}
          >
            {complete.isPending ? "Сохраняю…" : "Завершить"}
          </button>
        )}
        {pending && (
          <button className="pixel-btn text-sm" disabled={!online || busy} onClick={() => skip.mutate(quest.id)}>
            Пропустить
          </button>
        )}
        <button className="pixel-btn text-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Скрыть" : "Подробности"}
        </button>
      </div>
    </article>
  );
}
