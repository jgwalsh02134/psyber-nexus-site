function cors(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Max-Age': '86400'
  } as Record<string, string>;
}

export const onRequest = async (context: any) => {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '*';

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(origin) });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { ...cors(origin), 'Allow': 'POST, OPTIONS' }
    });
  }

  const apiKey = env?.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Missing OPENAI_API_KEY' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) }
    });
  }

  let body: any = null;
  try {
    body = await request.json();
  } catch (_) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) }
    });
  }

  const { messages, model = 'gpt-4o-mini' } = body || {};
  if (!Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: 'messages must be an array' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) }
    });
  }

  const payload = { model, stream: true, messages };

  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream'
    },
    body: JSON.stringify(payload)
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => 'Upstream error');
    return new Response(errText, {
      status: upstream.status || 502,
      headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) }
    });
  }

  const headers = new Headers();
  headers.set('Content-Type', 'text/event-stream; charset=utf-8');
  headers.set('Cache-Control', 'no-cache, no-transform');
  headers.set('Connection', 'keep-alive');
  headers.set('X-Accel-Buffering', 'no');
  for (const [k, v] of Object.entries(cors(origin))) headers.set(k, v);

  return new Response(upstream.body, { headers });
};
