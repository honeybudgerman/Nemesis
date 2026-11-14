import type { MentorEvaluationView } from "@/types/game";

const GRADE_STYLE: Record<string, string> = {
  S: "text-gold",
  A: "text-xp",
  B: "text-xp",
  C: "text-gold",
  D: "text-danger",
  F: "text-danger",
};

/** Orion's verdict. AI text is rendered as plain React text (escaped), never as HTML. */
export function EvaluationCard({ evaluation: e, title }: { evaluation: MentorEvaluationView; title?: boolean }) {
  return (
    <div className="mt-3 border-2 border-mana/50 bg-bg-deep p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-mana">{title ? e.questTitle : "Оценка Ориона"}</span>
        <span className={`font-display text-2xl ${GRADE_STYLE[e.grade] ?? ""}`}>{e.grade}</span>
      </div>
      {e.reasoning && <p className="mt-1 whitespace-pre-line text-text/90">{e.reasoning}</p>}
      {e.mistakes.length > 0 && (
        <>
          <div className="mt-2 text-xs font-semibold text-danger">Ошибки</div>
          <ul className="list-inside list-disc text-text/85">
            {e.mistakes.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </>
      )}
      {e.recommendations.length > 0 && (
        <>
          <div className="mt-2 text-xs font-semibold text-gold">Рекомендации</div>
          <ul className="list-inside list-disc text-text/85">
            {e.recommendations.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </>
      )}
      {e.nextTopic && <p className="mt-2 text-xs text-muted">Следующая тема: {e.nextTopic}</p>}
    </div>
  );
}
