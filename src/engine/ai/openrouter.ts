/**
 * Minimal OpenRouter client (ТЗ §3.4). Pure: the HTTP function is injected, so
 * the retry / validation logic is unit-tested without the network. Everything
 * the model returns is untrusted data: it is parsed, validated with Zod and
 * otherwise only ever rendered as plain text.
 */
import type { ZodType } from "zod";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/** Cheap model with structured-output support; override with OPENROUTER_MODEL. */
export const DEFAULT_MODEL = "openai/gpt-4.1-mini";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  /** USD × 1 000 000 (OpenRouter reports cost in credits = USD). */
  costMicros: number;
  attempts: number;
  model: string;
}

export interface AiRequest<T> {
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  /** Structured output: JSON Schema sent to the model + Zod schema enforced here. */
  structured?: { name: string; jsonSchema: Record<string, unknown>; schema: ZodType<T> };
  /** Extra semantic check after Zod (e.g. "exactly one optional quest"). Return an error text or null. */
  check?: (value: T) => string | null;
}

export type AiResult<T> =
  | { ok: true; value: T; usage: AiUsage }
  | { ok: false; reason: "invalid" | "unavailable"; error: string; usage: AiUsage };

export interface AiTransport {
  apiKey: string;
  model: string;
  fetch: typeof fetch;
  timeoutMs?: number;
  /** Total attempts including the first (ТЗ §9.3: a limited number of retries). */
  maxAttempts?: number;
  /** Optional attribution headers recommended by OpenRouter. */
  appUrl?: string;
}

class RetryableError extends Error {}

function emptyUsage(model: string): AiUsage {
  return { promptTokens: 0, completionTokens: 0, costMicros: 0, attempts: 0, model };
}

function stripFences(s: string): string {
  const t = s.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  return m ? m[1] : t;
}

async function postOnce(t: AiTransport, body: Record<string, unknown>, usage: AiUsage): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), t.timeoutMs ?? 25_000);
  let res: Response;
  try {
    res = await t.fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${t.apiKey}`,
        "Content-Type": "application/json",
        ...(t.appUrl ? { "HTTP-Referer": t.appUrl } : {}),
        "X-Title": "NEMESIS",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new RetryableError(ctrl.signal.aborted ? "timeout" : `network: ${e instanceof Error ? e.name : "error"}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429 || res.status >= 500) throw new RetryableError(`http ${res.status}`);
  // 400/401/402/403: configuration or credit problems — retrying will not help.
  if (!res.ok) throw new Error(`http ${res.status}`);

  const json = (await res.json().catch(() => null)) as {
    model?: string;
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    error?: { message?: string };
  } | null;
  if (!json) throw new RetryableError("bad json envelope");
  if (json.usage) {
    usage.promptTokens += Math.max(0, Math.floor(json.usage.prompt_tokens ?? 0));
    usage.completionTokens += Math.max(0, Math.floor(json.usage.completion_tokens ?? 0));
    usage.costMicros += Math.max(0, Math.round((json.usage.cost ?? 0) * 1_000_000));
  }
  if (json.model) usage.model = json.model;
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") throw new RetryableError("empty answer");
  return content;
}

export async function runCompletion<T = string>(t: AiTransport, req: AiRequest<T>): Promise<AiResult<T>> {
  const usage = emptyUsage(t.model);
  const maxAttempts = Math.max(1, Math.min(t.maxAttempts ?? 3, 5));
  const messages = [...req.messages];
  let lastError = "unknown";
  let invalid = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    usage.attempts = attempt;
    const body: Record<string, unknown> = {
      model: t.model,
      messages,
      max_tokens: req.maxTokens,
      temperature: req.temperature ?? 0.7,
      usage: { include: true },
    };
    if (req.structured) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: req.structured.name, strict: true, schema: req.structured.jsonSchema },
      };
      // Route only to providers that honour the schema.
      body.provider = { require_parameters: true };
    }

    let content: string;
    try {
      content = await postOnce(t, body, usage);
    } catch (e) {
      lastError = e instanceof Error ? e.message : "error";
      invalid = false;
      if (e instanceof RetryableError) continue;
      break;
    }

    if (!req.structured) {
      return { ok: true, value: content.trim() as T, usage };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(content));
    } catch {
      lastError = "answer is not JSON";
      invalid = true;
      messages.push({ role: "assistant", content: content.slice(0, 2000) });
      messages.push({ role: "user", content: "Ответ должен быть только JSON строго по схеме. Повтори ответ." });
      continue;
    }
    const v = req.structured.schema.safeParse(parsed);
    const problem = v.success ? (req.check?.(v.data) ?? null) : v.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    if (v.success && !problem) return { ok: true, value: v.data, usage };
    lastError = `schema: ${problem}`.slice(0, 280);
    invalid = true;
    messages.push({ role: "assistant", content: content.slice(0, 2000) });
    messages.push({ role: "user", content: `Ответ не прошёл проверку (${lastError}). Исправь и верни только JSON.` });
  }

  return { ok: false, reason: invalid ? "invalid" : "unavailable", error: lastError, usage };
}
