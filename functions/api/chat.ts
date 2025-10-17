export const onRequest: PagesFunction = async (ctx) => {
  const { request, env } = ctx;

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return new Response("Missing OPENAI_API_KEY", { status: 500 });

  let payload: any = {};
  try { payload = await request.json(); }
  catch { return new Response("Invalid JSON", { status: 400 }); }

  const model =
    (typeof payload?.model === "string" && payload.model.trim()) ||
    env.OPENAI_MODEL ||
    "gpt-5";

  const useResponses =
    env.USE_RESPONSES_API === "1" || payload?.useResponses === true;

  const origin = new URL(request.url).origin;
  const sseHeaders = new Headers({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": origin,
    "x-psyber-model": model,
  });

  const messages = Array.isArray(payload?.messages) ? payload.messages : [];

  async function forwardChatCompletions() {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, stream: true }),
    });

    if (!upstream.ok || !upstream.body) {
      const t = await upstream.text().catch(() => "");
      return new Response(t || "Upstream error", { status: upstream.status || 502 });
    }
    return new Response(upstream.body, { headers: sseHeaders });
  }

  if (useResponses) {
    // Map chat-style messages → Responses "input"
    const input: any[] = [];
    for (const m of messages) {
      const role =
        m.role === "system" ? "developer" :
        m.role === "assistant" ? "assistant" : "user";
      input.push({ role, content: [{ type: "input_text", text: String(m.content ?? "") }] });
    }

    if (input.length) {
      const upstream = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, input, stream: true }),
      });

      if (upstream.ok && upstream.body) {
        return new Response(upstream.body, { headers: sseHeaders });
      }
      // fall back if the new endpoint rejects our payload
    }
  }

  return forwardChatCompletions();
};