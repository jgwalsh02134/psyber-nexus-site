function buildSSEHeaders(origin: string, model: string): Headers {
  const h = new Headers();
  h.set("Content-Type", "text/event-stream; charset=utf-8");
  h.set("Cache-Control", "no-cache");
  h.set("Connection", "keep-alive");
  h.set("Access-Control-Allow-Origin", origin);
  h.set("x-psyber-model", model);
  return h;
}

function mapToResponsesInput(messages: any[]): any[] {
  const input: any[] = [];
  for (const m of messages) {
    const role = m?.role === "system" ? "developer" : (m?.role === "assistant" ? "assistant" : "user");
    if (Array.isArray(m?.content)) {
      input.push({ role, content: m.content });
    } else {
      input.push({ role, content: [{ type: "input_text", text: String(m?.content ?? "") }] });
    }
  }
  return input;
}

async function postChatCompletions(apiKey: string, model: string, messages: any[], sseHeaders: Headers, tStart: number): Promise<Response> {
  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!upstream.ok || !upstream.body) {
    const t = await upstream.text().catch(() => "");
    return new Response(t || "Upstream error", { status: upstream.status || 502 });
  }
  sseHeaders.append("Server-Timing", `openai;dur=${Date.now() - tStart}`);
  return new Response(upstream.body, { headers: sseHeaders });
}

async function postResponses(apiKey: string, model: string, input: any[], sseHeaders: Headers, tStart: number): Promise<Response | null> {
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input, stream: true }),
  });
  if (upstream.ok && upstream.body) {
    sseHeaders.append("Server-Timing", `openai;dur=${Date.now() - tStart}`);
    return new Response(upstream.body, { headers: sseHeaders });
  }
  return null;
}

export const onRequest = async (ctx: { request: Request; env: Record<string, any> }) => {
  const { request, env } = ctx;

  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const apiKey = env.OPENAI_API_KEY as string | undefined;
  if (!apiKey) return new Response("Missing OPENAI_API_KEY", { status: 500 });

  let payload: any = {};
  try { payload = await request.json(); } catch { payload = {}; }

  const DEFAULT_MODEL = (env.OPENAI_MODEL as string) || "gpt-5";
  const FAST_MODEL    = (env.OPENAI_FAST_MODEL as string) || "gpt-4o-mini";
  const fromBody      = (typeof payload?.model === "string" && payload.model.trim()) ? payload.model.trim() : null;
  const useFast       = !!payload?.fast;
  const model         = fromBody || (useFast ? FAST_MODEL : DEFAULT_MODEL);

  const useResponses  = env.USE_RESPONSES_API === "1" || payload?.useResponses === true;

  const origin = new URL(request.url).origin;
  const sseHeaders = buildSSEHeaders(origin, model);
  const tStart = Date.now();
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];

  if (useResponses) {
    const input = mapToResponsesInput(messages);
    const resp = await postResponses(String(apiKey), model, input, sseHeaders, tStart);
    if (resp) return resp;
  }

  return postChatCompletions(String(apiKey), model, messages, sseHeaders, tStart);
};