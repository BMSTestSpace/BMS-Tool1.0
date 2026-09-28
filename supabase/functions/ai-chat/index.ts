import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "x-request-id",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const attempt = "body";
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const body = await req.json();
    const { contents, generationConfig = {}, continuationNumber = 0, attempt: bodyAttempt = 1, requestId: bodyRequestId } = body;
    const effectiveRequestId = bodyRequestId || requestId;
    const effectiveAttempt = Number(bodyAttempt) || 1;
    if (!Array.isArray(contents) || !contents.length) {
      return new Response(JSON.stringify({ error: "contents is required", requestId }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId } });
    }

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            ...generationConfig,
            temperature: 0.5,
            maxOutputTokens: Math.max(Number(generationConfig.maxOutputTokens || 4096), 4096),
            thinkingConfig: { thinkingBudget: 256 },
          },
        }),
      },
    );

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error(JSON.stringify({ requestId, state: "upstream_error", status: upstream.status, detail: detail.slice(0, 1000) }));
      return new Response(JSON.stringify({ error: `Gemini upstream HTTP ${upstream.status}`, detail, requestId }), {
        status: upstream.status,
        headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId },
      });
    }

    if (!upstream.body) throw new Error("Gemini returned no streaming body");
    console.log(JSON.stringify({ requestId: effectiveRequestId, attempt: effectiveAttempt, continuationNumber, state: "stream_started", maxOutputTokens: 4096, thinkingBudget: 256 }));

    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "x-request-id": requestId,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ requestId, state: "function_error", error: message }));
    return new Response(JSON.stringify({ error: message, requestId }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId },
    });
  }
});
