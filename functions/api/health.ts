export const onRequestGet = async () => {
  const body = JSON.stringify({ ok: true, service: "psyber-nexus", ts: new Date().toISOString() });
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
};
