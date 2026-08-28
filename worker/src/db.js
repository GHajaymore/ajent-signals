// Cloudflare KV store, keyed like the AWS single-table (pk|sk). Small dataset, so
// list+get per key is fine. env.AJENT_KV is the bound KV namespace.
export function db(env) {
  const kv = env.AJENT_KV;
  const key = (pk, sk) => `${pk}|${sk}`;
  return {
    put: (item) => kv.put(key(item.pk, item.sk), JSON.stringify(item)),
    get: async (pk, sk) => { const v = await kv.get(key(pk, sk)); return v ? JSON.parse(v) : null; },
    del: (pk, sk) => kv.delete(key(pk, sk)),
    async list(pk, { limit } = {}) {
      const out = []; let cursor;
      for (;;) {
        const r = await kv.list({ prefix: `${pk}|`, cursor });
        for (const k of r.keys) { const v = await kv.get(k.name); if (v) out.push(JSON.parse(v)); if (limit && out.length >= limit) return out; }
        if (r.list_complete) break;
        cursor = r.cursor;
      }
      return out;
    },
  };
}
