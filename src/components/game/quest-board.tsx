"use client";

import { useState } from "react";
import { QuestCard } from "@/components/quests/quest-card";
import { SKILL_CODES, SKILL_LABELS } from "@/data/skills";
import { useCreateQuest } from "@/hooks/use-game";
import { useOnline } from "@/hooks/use-online";
import type { QuestView } from "@/types/game";
import { StateGate } from "./state-gate";

type Tab = "daily" | "weekly" | "monthly";
const TABS: { id: Tab; label: string }[] = [
  { id: "daily", label: "Сегодня" },
  { id: "weekly", label: "Неделя" },
  { id: "monthly", label: "Месяц" },
];

export function QuestBoard() {
  const [tab, setTab] = useState<Tab>("daily");
  return (
    <StateGate>
      {(s) => {
        const list = s.quests[tab];
        const done = list.filter((q) => q.status === "COMPLETED").length;
        return (
          <div>
            <div className="flex items-baseline justify-between">
              <h1 className="font-display text-2xl text-gold">Задания</h1>
              <span className="text-sm text-muted">Бюджет: {s.user.dailyMinutes} мин/день</span>
            </div>
            <div role="tablist" className="mt-3 flex gap-2">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`pixel-btn flex-1 text-sm ${tab === t.id ? "pixel-btn-gold" : ""}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label} ({s.quests[t.id].filter((q) => q.status === "COMPLETED").length}/{s.quests[t.id].length})
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted">
              {tab === "daily" && "Три основных задания и одно необязательное. Пропуск не отнимает уже заработанный опыт."}
              {tab === "weekly" && `Задания недели с ${new Date(s.periods.weekStart).toLocaleDateString("ru-RU")}.`}
              {tab === "monthly" && "Большие цели месяца."}
              {list.length > 0 && ` Выполнено ${done} из ${list.length}.`}
            </p>
            <div className="mt-3 grid gap-3">
              {sortQuests(list).map((q) => (
                <QuestCard key={q.id} quest={q} />
              ))}
              {list.length === 0 && <p className="text-muted">Заданий нет.</p>}
            </div>
            {tab === "daily" && <ManualQuestForm />}
          </div>
        );
      }}
    </StateGate>
  );
}

function sortQuests(list: QuestView[]): QuestView[] {
  const rank = (q: QuestView) => (q.status === "PENDING" ? 0 : 1) * 10 + (q.isOptional ? 1 : 0);
  return [...list].sort((a, b) => rank(a) - rank(b));
}

function ManualQuestForm() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("discipline");
  const [difficulty, setDifficulty] = useState(2);
  const [minutes, setMinutes] = useState(20);
  const create = useCreateQuest();
  const online = useOnline();

  if (!open) {
    return (
      <button className="pixel-btn mt-4 w-full text-sm" onClick={() => setOpen(true)}>
        + Своё задание на сегодня
      </button>
    );
  }
  return (
    <form
      className="pixel-panel mt-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate(
          { title, category, difficulty, estimatedMinutes: minutes },
          {
            onSuccess: () => {
              setTitle("");
              setOpen(false);
            },
          },
        );
      }}
    >
      <h2 className="font-display text-gold">Своё задание</h2>
      <p className="mt-1 text-xs text-muted">
        Опыт назначает движок по времени и сложности. Не больше 3 своих заданий и 60 XP за них в день.
      </p>
      <label className="mt-3 block">
        <span className="text-sm text-muted">Что сделать</span>
        <input className="pixel-input mt-1" required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <label className="block">
          <span className="text-xs text-muted">Навык</span>
          <select className="pixel-input mt-1 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
            {SKILL_CODES.map((c) => (
              <option key={c} value={c}>
                {SKILL_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted">Сложность</span>
          <select className="pixel-input mt-1 text-sm" value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted">Минут</span>
          <input
            className="pixel-input mt-1 text-sm"
            type="number"
            min={5}
            max={120}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="submit" className="pixel-btn pixel-btn-gold flex-1 text-sm" disabled={!online || create.isPending}>
          {create.isPending ? "Сохраняю…" : "Добавить"}
        </button>
        <button type="button" className="pixel-btn text-sm" onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
    </form>
  );
}
