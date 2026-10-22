// BMS Troubleshooter - ai-chat Edge Function
// Version 0.6.24 (previous deployed version: 0.6.13-r1)
//
// Streams Gemini responses to the BMS Troubleshooter Copilot panel.
// Changes in 0.6.24 (the request and response format the app uses is unchanged):
//  - Uses the built-in Deno.serve instead of the old std@0.168.0 import.
//  - The Gemini API key is sent in the x-goog-api-key header, not in the URL (URLs end up in logs).
//  - Requests are validated and size-limited; only text parts, user/model roles, and a small set of
//    generationConfig fields are forwarded, with output tokens capped.
//  - Upstream error bodies are logged but no longer returned to the browser.
//  - Upstream calls time out and stop if the browser disconnects.
//  - Optional ALLOWED_ORIGINS secret restricts browser origins. If it is not set, behaviour is unchanged ("*").
//
// Optional secrets (Supabase Dashboard > Edge Functions > Secrets):
//   GEMINI_API_KEY   required (already configured)
//   GEMINI_MODEL     optional, defaults to gemini-2.5-flash
//   ALLOWED_ORIGINS  optional, comma-separated, e.g. https://yourorg.github.io

const FUNCTION_VERSION = "0.6.24";
const MODEL = (Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash").trim();
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map((s: string) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);

const MAX_BODY_BYTES = 512 * 1024;
const MAX_MESSAGES = 60;
const MAX_TOTAL_CHARS = 400_000;
const MAX_OUTPUT_TOKENS = 8192;
const MAX_THINKING_BUDGET = 1024;
const UPSTREAM_TIMEOUT_MS = 115_000;

function corsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
    "Access-Control-Expose-Headers": "x-request-id, x-bms-copilot-version",
    "Access-Control-Max-Age": "86400",
  };
  if (ALLOWED_ORIGINS.length === 0) {
    headers["Access-Control-Allow-Origin"] = "*";
  } else {
    const origin = (req.headers.get("origin") || "").replace(/\/$/, "");
    headers["Vary"] = "Origin";
    if (origin && ALLOWED_ORIGINS.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(req: Request, body: unknown, status: number, requestId?: string): Response {
  const headers: Record<string, string> = {
    ...corsHeaders(req),
    "Content-Type": "application/json",
    "x-bms-copilot-version": FUNCTION_VERSION,
  };
  if (requestId) headers["x-request-id"] = requestId;
  return new Response(JSON.stringify(body), { status, headers });
}

function cleanRequestId(value: unknown): string {
  if (typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value)) return value;
  return crypto.randomUUID();
}

// Keeps only {role: "user" | "model", parts: [{text}]} and enforces size limits.
function sanitizeContents(input: unknown): { contents?: unknown[]; error?: string } {
  if (!Array.isArray(input) || input.length === 0) return { error: "contents is required" };
  if (input.length > MAX_MESSAGES) return { error: `contents has too many messages (max ${MAX_MESSAGES})` };
  const contents: unknown[] = [];
  let total = 0;
  for (const item of input) {
    const role = (item as { role?: unknown })?.role;
    const parts = (item as { parts?: unknown })?.parts;
    if ((role !== "user" && role !== "model") || !Array.isArray(parts)) return { error: "invalid contents entry" };
    const texts: { text: string }[] = [];
    for (const part of parts) {
      const text = (part as { text?: unknown })?.text;
      if (typeof text !== "string") return { error: "only text parts are supported" };
      total += text.length;
      texts.push({ text });
    }
    if (!texts.length) return { error: "empty message" };
    contents.push({ role, parts: texts });
  }
  if (total > MAX_TOTAL_CHARS) return { error: "request is too large" };
  return { contents };
}

function sanitizeGenerationConfig(input: unknown): Record<string, unknown> {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const temperature = num(src.temperature);
  if (temperature !== undefined) out.temperature = Math.min(Math.max(temperature, 0), 1);
  const topP = num(src.topP);
  if (topP !== undefined) out.topP = Math.min(Math.max(topP, 0), 1);
  const topK = num(src.topK);
  if (topK !== undefined) out.topK = Math.min(Math.max(Math.floor(topK), 1), 100);
  const maxOut = num(src.maxOutputTokens);
  out.maxOutputTokens = Math.min(Math.max(Math.floor(maxOut ?? 4096), 1), MAX_OUTPUT_TOKENS);
  const thinking = src.thinkingConfig as { thinkingBudget?: unknown } | undefined;
  const budget = num(thinking?.thinkingBudget);
  if (budget !== undefined) out.thinkingConfig = { thinkingBudget: Math.min(Math.max(Math.floor(budget), 0), MAX_THINKING_BUDGET) };
  return out;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  let requestId = crypto.randomUUID();
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
    if (!/^[A-Za-z0-9._-]+$/.test(MODEL)) throw new Error("GEMINI_MODEL is invalid");

    const declared = Number(req.headers.get("content-length") || "0");
    if (declared > MAX_BODY_BYTES) return json(req, { error: "request is too large", requestId }, 413, requestId);
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json(req, { error: "request is too large", requestId }, 413, requestId);

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(req, { error: "invalid JSON body", requestId }, 400, requestId);
    }
    requestId = cleanRequestId(body?.requestId);

    const checked = sanitizeContents(body?.contents);
    if (checked.error) return json(req, { error: checked.error, requestId }, 400, requestId);
    const generationConfig = sanitizeGenerationConfig(body?.generationConfig);

    const signals: AbortSignal[] = [AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)];
    if (req.signal) signals.push(req.signal);
    const signal = typeof AbortSignal.any === "function" ? AbortSignal.any(signals) : signals[0];

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ contents: checked.contents, generationConfig }),
        signal,
      },
    );

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error(JSON.stringify({ requestId, state: "upstream_error", status: upstream.status, detail: detail.slice(0, 1000) }));
      const status = upstream.status === 429 ? 429 : 502;
      return json(req, { error: `AI service error (HTTP ${upstream.status})`, requestId }, status, requestId);
    }
    if (!upstream.body) throw new Error("Gemini returned no streaming body");

    console.log(JSON.stringify({ requestId, state: "stream_started", messages: (checked.contents as unknown[]).length }));
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders(req),
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "x-request-id": requestId,
        "x-bms-copilot-version": FUNCTION_VERSION,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ requestId, state: "function_error", error: message }));
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return json(req, { error: timedOut ? "AI service timed out" : "AI service is temporarily unavailable", requestId }, timedOut ? 504 : 500, requestId);
  }
}

Deno.serve(handler);
