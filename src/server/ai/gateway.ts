import "server-only";
import { DEFAULT_MODEL, runCompletion, type AiRequest, type AiResult } from "@/engine/ai/openrouter";
import { parseLocalDate, questPeriods, startOfLocalDay } from "@/lib/time";
import { fromDbError } from "@/server/http/errors";
import { getAdminSupabase } from "@/server/supabase/admin";

/**
 * Single server-side AI Gateway (ТЗ §3.4). The OpenRouter key lives only in
 * server env; the model is swappable via OPENROUTER_MODEL. Every call is
 * booked against the player's daily request limit and monthly budget first,
 * and its tokens and cost are written to ai_usage_logs.
 */
export type AiKind = "MENTOR_CHAT" | "EVALUATE" | "GENERATE_QUESTS";

export type GatewayResult<T> =
  | AiResult<T>
  | { ok: false; reason: "unconfigured"; error: string }
  | { ok: false; reason: "limited"; error: string; limit: "daily" | "budget" };

export function aiConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  const model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
  return { configured: apiKey.length > 0, apiKey, model };
}

export function aiPeriods(tz: string, now = new Date()) {
  const p = questPeriods(now, tz);
  return { dayStart: p.dayStart, monthStart: startOfLocalDay(parseLocalDate(p.monthStart), tz) };
}

export async function callAi<T>(userId: string, timezone: string, kind: AiKind, req: AiRequest<T>): Promise<GatewayResult<T>> {
  const cfg = aiConfig();
  if (!cfg.configured) return { ok: false, reason: "unconfigured", error: "OPENROUTER_API_KEY is not set" };

  const admin = getAdminSupabase();
  const { dayStart, monthStart } = aiPeriods(timezone);
  const reserved = await admin.rpc("reserve_ai_request", {
    p_user_id: userId,
    p_kind: kind,
    p_day_start: dayStart.toISOString(),
    p_month_start: monthStart.toISOString(),
  });
  if (reserved.error) throw fromDbError(reserved.error);
  const r = reserved.data as { status: "ok"; id: string } | { status: "limited"; reason: "daily" | "budget" };
  if (r.status === "limited") return { ok: false, reason: "limited", limit: r.reason, error: `limit: ${r.reason}` };

  let result: AiResult<T>;
  try {
    result = await runCompletion(
      {
        apiKey: cfg.apiKey,
        model: cfg.model,
        fetch,
        appUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined,
      },
      req,
    );
  } catch (e) {
    result = {
      ok: false,
      reason: "unavailable",
      error: e instanceof Error ? e.message : "error",
      usage: { promptTokens: 0, completionTokens: 0, costMicros: 0, attempts: 1, model: cfg.model },
    };
  }

  const fin = await admin.rpc("finish_ai_request", {
    p_user_id: userId,
    p_id: r.id,
    p_status: result.ok ? "OK" : result.reason === "invalid" ? "INVALID" : "FAILED",
    p_model: result.usage.model,
    p_prompt_tokens: result.usage.promptTokens,
    p_completion_tokens: result.usage.completionTokens,
    p_cost_micros: result.usage.costMicros,
    p_attempts: result.usage.attempts,
    // Never the request or the key: only our own short error label.
    p_error: result.ok ? null : result.error.slice(0, 300),
  });
  if (fin.error) console.error("[ai] failed to log usage:", fin.error.message);
  if (!result.ok) console.warn(`[ai] ${kind} failed: ${result.reason} (${result.error})`);
  return result;
}
