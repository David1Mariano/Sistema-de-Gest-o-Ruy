// Fase 5: backend Node real para a IA local. HTTP de verdade, sem rede externa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSocialAIHost, parseOrigins, corsHeaders, createRateLimiter, createSafeLogger, requireLoadComment } from '../server/social/aiHost.mjs';
import { createSupabaseIdentityVerifier, createDenyAllAccountAccess } from '../server/social/aiAuth.mjs';
import { createSocialAIHandler, FALLBACK_MESSAGE } from '../server/social/aiHandler.mjs';
import { SocialAIService } from '../server/social/ai.mjs';
import { socialAIConfigFromEnvironment, buildSocialAIBackend } from '../server/social/aiBackend.mjs';


const SUPA = 'https://projeto.supabase.co';

// Identidade real: o stub responde como o Supabase responderia (Auth + records).
function supabaseStub({ user = { id: 'auth-1', app_metadata: { legacy_auth_user_id: 'leg-1', system_role: 'admin' } }, profile = { id: 'leg-1', status: 'ativo' }, rows = null, authOk = true } = {}) {
  return async (url, init) => {
    const headers = init?.headers || {};
    if (url.startsWith(`${SUPA}/auth/v1/user`)) {
      if (!authOk) return new Response('{}', { status: 401 });
      return Response.json(user);
    }
    if (url.startsWith(`${SUPA}/rest/v1/records`)) {
      if (headers.authorization !== 'Bearer token-valido') return new Response('[]', { status: 401 });
      return Response.json(rows !== null ? rows : [profile]);
    }
    return new Response('', { status: 404 });
  };
}

const backend = ({ request = supabaseStub(), service = null, comments = { c1: { id: 'c1', account_id: 'acc-1', text: 'Produto veio errado' } }, onComment = null, origins = ['http://localhost:5173'], ...rest } = {}) => {
  const loadComment = onComment || (async (id) => comments[id] || null);
  const verifyIdentity = createSupabaseIdentityVerifier({ url: SUPA, anonKey: 'anon-chave', request });
  const ai = service || new SocialAIService({ provider: { name: 'ollama', health: async () => ({ provider: 'ollama', state: 'ready', host: '127.0.0.1', model: 'llama3' }), classifyComment: async () => ({ category: 'reclamacao', confidence: 0.9 }), draftReply: async () => ({ reply: 'Vamos verificar.', category: 'reclamacao', confidence: 0.9, safety: { level: 'high', reasons: [] } }) } });
  const limiter = createRateLimiter({ limit: rest.draftLimit ?? 10, windowMs: rest.draftWindowMs ?? 60000 });
  return createSocialAIHost({
    handler: createSocialAIHandler({ service: ai, verifyIdentity, loadComment, allowDraft: (id) => limiter.check(`user:${id}`) }),
    origins, enforceLocal: false, log: createSafeLogger(rest.sink || (() => {})), ...rest,
  });
};

const listen = async (server) => { await new Promise((r) => server.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${server.address().port}`; };
const call = async (base, path, { method = 'GET', body, token = 'token-valido', origin = 'http://localhost:5173', raw = false } = {}) => {
  const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) }, ...(raw ? { body } : body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
};
const withServer = async (server, fn) => { const base = await listen(server); try { return await fn(base); } finally { await new Promise((r) => server.close(r)); } };

// 1-4. AutenticaÃ§Ã£o e permissÃµes.
test('1. sem autenticaÃ§Ã£o â†’ 401 em health e draft', async () => {
  await withServer(backend(), async (base) => {
    assert.equal((await call(base, '/social-ai/health', { token: null })).status, 401);
    assert.equal((await call(base, '/social-ai/draft', { method: 'POST', token: null, body: { commentId: 'c1' } })).status, 401);
    assert.equal((await call(base, '/social-ai/health', { token: 'token-errado' })).status, 401, 'token invÃ¡lido do Supabase tambÃ©m');
  });
});
test('2. usuÃ¡rio inativo â†’ bloqueado', async () => {
  const request = supabaseStub({ profile: { id: 'leg-1', status: 'inativo' } });
  await withServer(backend({ request }), async (base) => {
    assert.equal((await call(base, '/social-ai/health')).status, 401);
  });
});
test('3. sem permissÃ£o approve_ai â†’ 403 no health', async () => {
  const request = supabaseStub({ user: { id: 'auth-1', app_metadata: { legacy_auth_user_id: 'leg-1', system_role: 'manager' } } });
  await withServer(backend({ request }), async (base) => {
    assert.equal((await call(base, '/social-ai/health')).status, 403);
  });
});
test('4. sem permissÃ£o reply â†’ 403 no draft', async () => {
  // viewer tem `view` mas nÃ£o `reply`: matrix real de socialPermissions.
  const request = supabaseStub({ user: { id: 'auth-1', app_metadata: { legacy_auth_user_id: 'leg-1', system_role: 'viewer' } } });
  await withServer(backend({ request }), async (base) => {
    assert.equal((await call(base, '/social-ai/draft', { method: 'POST', body: { commentId: 'c1' } })).status, 403);
  });
});
test('sem vÃ­nculo legado ou sem system_role â†’ identidade negada', async () => {
  for (const app_metadata of [{}, { system_role: 'admin' }, { legacy_auth_user_id: 'leg-1' }]) {
    const verify = createSupabaseIdentityVerifier({ url: SUPA, anonKey: 'anon-chave', request: supabaseStub({ user: { id: 'auth-1', app_metadata } }) });
    assert.equal((await verify('Bearer token-valido')).id, null, `deveria negar ${JSON.stringify(app_metadata)}`);
  }
});


// 5-7. loadComment obrigatÃ³rio: inexistente, conta negada e texto forjado.
test('5. comentÃ¡rio inexistente â†’ 404', async () => {
  await withServer(backend(), async (base) => {
    assert.equal((await call(base, '/social-ai/draft', { method: 'POST', body: { commentId: 'nao-existe' } })).status, 404);
  });
});
test('6. conta nÃ£o visÃ­vel â†’ 403 (fail-closed do isAccountVisible)', async () => {
  const negar = createDenyAllAccountAccess();
  await assert.rejects(negar('leg-1', 'acc-1'), { code: 'SCHEMA_SOCIAL_NAO_APLICADO' });
  const host = backend({ onComment: async () => { const e = new Error('Conta nÃ£o autorizada'); e.code = 'FORBIDDEN'; throw e; } });
  await withServer(host, async (base) => {
    const r = await call(base, '/social-ai/draft', { method: 'POST', body: { commentId: 'c1' } });
    assert.equal(r.status, 403);
    assert.equal(r.body.message, FALLBACK_MESSAGE);
  });
});
test('7. texto do body nÃ£o substitui o texto persistido', async () => {
  const vistos = [];
  const service = new SocialAIService({ provider: { health: async () => ({ provider: 'ollama', state: 'ready' }), classifyComment: async (c) => { vistos.push(c.text); return { category: 'elogio', confidence: 0.5 }; }, draftReply: async (c) => { vistos.push(c.text); return { reply: 'ok', category: 'elogio', confidence: 0.5 }; } } });
  const host = backend({ service, onComment: async (id) => (id === 'c1' ? { id: 'c1', text: 'TEXTO PERSISTIDO do banco' } : null) });
  await withServer(host, async (base) => {
    const r = await call(base, '/social-ai/draft', { method: 'POST', raw: true, body: JSON.stringify({ commentId: 'c1', text: 'TEXTO FORJADO pelo navegador' }) });
    assert.equal(r.status, 200);
    assert.deepEqual([...new Set(vistos)], ['TEXTO PERSISTIDO do banco'], 'o backend precisa usar o texto do banco');
  });
});
test('sem loadComment nÃ£o hÃ¡ host possÃ­vel', () => {
  assert.throws(() => requireLoadComment(null), /exige loadComment/);
  assert.equal(typeof requireLoadComment(async () => ({})), 'function');
});

// 8-9. Health sanitizado e draft vÃ¡lido.
test('8. health sanitizado: sÃ³ status, provider, host redigido, model, ready', async () => {
  const service = new SocialAIService({ provider: { health: async () => ({ provider: 'ollama', state: 'ready', host: '127.0.0.1:11434', model: 'llama3', base_url: 'http://user:senha@10.0.0.5:11434', headers: { authorization: 'Bearer segredo' }, raw: 'conexao recusada' }) } });
  await withServer(backend({ service }), async (base) => {
    const r = await call(base, '/social-ai/health');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['host', 'model', 'provider', 'ready', 'status']);
    const s = JSON.stringify(r.body);
    for (const segredo of ['senha', 'segredo', 'Bearer', '10.0.0.5', 'conexao recusada']) assert.ok(!s.includes(segredo), `health vazou ${segredo}`);
  });
});
test('9. draft vÃ¡lido devolve sÃ³ a estrutura segura', async () => {
  await withServer(backend(), async (base) => {
    const r = await call(base, '/social-ai/draft', { method: 'POST', body: { commentId: 'c1' } });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['automaticAllowed', 'category', 'categoryRecognized', 'confidence', 'requiresHuman', 'safety', 'status', 'text']);
    assert.equal(r.body.text, 'Vamos verificar.');
    assert.equal(r.body.requiresHuman, true);
    assert.equal(r.body.automaticAllowed, false);
  });
});

// 10-12. Timeout, offline e modelo ausente viram erro controlado.
test('10. timeout â†’ resposta controlada, sem conexÃ£o pendurada', async () => {
  const service = new SocialAIService({ provider: { health: async () => ({ provider: 'ollama', state: 'ready' }), draftReply: async () => { throw Object.assign(new Error('timeout'), { code: 'AI_TIMEOUT' }); }, classifyComment: async () => ({ category: 'elogio', confidence: 0.5 }) } });
  await withServer(backend({ service }), async (base) => {
    const r = await call(base, '/social-ai/draft', { method: 'POST', body: { commentId: 'c1' } });
    assert.equal(r.status, 503);
    assert.equal(r.body.message, FALLBACK_MESSAGE);
    assert.ok(!JSON.stringify(r.body).includes('timeout'));
  });
});
test('11. Ollama offline → health offline e draft com FALLBACK_MESSAGE', async () => {
  const service = new SocialAIService({ provider: { health: async () => ({ provider: 'ollama', state: 'offline' }), draftReply: async () => { throw Object.assign(new Error('offline'), { code: 'AI_UNREACHABLE' }); }, classifyComment: async () => ({ category: 'elogio', confidence: 0.5 }) } });
  await withServer(backend({ service }), async (base) => {
    assert.equal((await call(base, '/social-ai/health')).body.status, 'offline');
    const r = await call(base, '/social-ai/draft', { method: 'POST', body: { commentId: 'c1' } });
    assert.equal(r.status, 503);
    assert.equal(r.body.message, FALLBACK_MESSAGE);
  });
});
test('12. modelo ausente → health model_unavailable', async () => {
  const service = new SocialAIService({ provider: { health: async () => ({ provider: 'ollama', state: 'model_unavailable' }) } });
  await withServer(backend({ service }), async (base) => {
    const r = await call(base, '/social-ai/health');
    assert.equal(r.body.status, 'model_unavailable');
    assert.equal(r.body.ready, false);
  });
});

// 13-16. Payload, rate limit e CORS.
test('13. payload grande e payload inválido são recusados', async () => {
  await withServer(backend(), async (base) => {
    assert.equal((await call(base, '/social-ai/draft', { method: 'POST', raw: true, body: JSON.stringify({ commentId: 'c1', text: 'x'.repeat(20000) }) })).status, 413);
    assert.equal((await call(base, '/social-ai/draft', { method: 'POST', raw: true, body: '{nao é json' })).status, 400);
    assert.equal((await call(base, '/social-ai/draft', { method: 'POST', raw: true, body: JSON.stringify({ commentId: '../../etc/passwd' }) })).status, 400);
    assert.equal((await call(base, '/social-ai/draft', { method: 'POST', raw: true, body: JSON.stringify({}) })).status, 400);
  });
});
test('14. rate limit por usuário segura cliques repetidos', async () => {
  await withServer(backend({ draftLimit: 3 }), async (base) => {
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await call(base, '/social-ai/draft', { method: 'POST', body: { commentId: 'c1' } })).status);
    assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
    assert.deepEqual(statuses.slice(3), [429, 429], 'clique repetido não pode virar dezenas de inferências');
  });
});
test('14b. rate limit isolado por usuário', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(limiter.check('user:a').allowed, true);
  assert.equal(limiter.check('user:a').allowed, false);
  assert.equal(limiter.check('user:b').allowed, true, 'outro usuário tem o próprio orçamento');
});
test('15. CORS permitido ecoa a origem e libera o preflight', async () => {
  await withServer(backend(), async (base) => {
    const r = await call(base, '/social-ai/health');
    assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.match(r.headers.get('access-control-allow-headers') || '', /authorization/);
    assert.equal((await fetch(`${base}/social-ai/draft`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } })).status, 204);
  });
});
test('16. CORS não permitido é negado e nunca vira `*`', async () => {
  assert.throws(() => parseOrigins('*'), /invalida/);
  assert.equal(corsHeaders('https://site-malicioso.example', ['http://localhost:5173']), null);
  await withServer(backend(), async (base) => {
    const r = await call(base, '/social-ai/health', { origin: 'https://site-malicioso.example' });
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('access-control-allow-origin'), null, 'origem não permitida não recebe CORS');
  });
});

// 17-18. Segredos e logs.
test('17. nenhum secret em resposta nem em header', async () => {
  await withServer(backend(), async (base) => {
    for (const path of ['/social-ai/health', '/social-ai/draft']) {
      const isDraft = path.endsWith('draft');
      // GET não leva corpo: enviar body num GET é erro do próprio fetch, não do host.
      const r = await call(base, path, { method: isDraft ? 'POST' : 'GET', ...(isDraft ? { body: { commentId: 'c1' } } : {}) });
      const tudo = JSON.stringify(r.body) + JSON.stringify([...r.headers]);
      for (const segredo of ['anon-chave', 'sb_secret', 'service_role', '11434', 'token-valido']) {
        assert.ok(!tudo.includes(segredo), `${path} vazou ${segredo}`);
      }
    }
  });
});
test('18. log operacional não contém prompt, comentário, token ou Authorization', async () => {
  const registros = [];
  const service = new SocialAIService({ provider: { health: async () => ({ provider: 'ollama', state: 'ready' }), classifyComment: async () => ({ category: 'reclamacao', confidence: 0.9 }), draftReply: async () => ({ reply: 'Texto sugerido com CPF 123.456.789-00', category: 'reclamacao', confidence: 0.9 }) } });
  await withServer(backend({ service, sink: (e) => registros.push(e) }), async (base) => {
    await call(base, '/social-ai/draft', { method: 'POST', body: { commentId: 'c1' } });
    await call(base, '/social-ai/health');
  });
  assert.ok(registros.length >= 2, 'deve registrar as chamadas');
  const tudo = JSON.stringify(registros);
  for (const proibido of ['Produto veio errado', '123.456.789-00', 'Texto sugerido', 'token-valido', 'authorization', 'Bearer', 'anon-chave', 'prompt']) {
    assert.ok(!tudo.includes(proibido), `log vazou ${proibido}`);
  }
  const permitidos = ['event', 'status', 'duration_ms', 'provider', 'model', 'error_code', 'user', 'route', 'at'];
  for (const registro of registros) {
    assert.deepEqual(Object.keys(registro).filter((k) => !permitidos.includes(k)), [], 'log tem campo fora da allowlist');
  }
  assert.ok(registros.some((r) => r.event === 'health' && r.provider === 'ollama'), 'log deve trazer status do provider');
});
test('18b. logger recusa campos fora da allowlist', () => {
  const capturados = [];
  const log = createSafeLogger((e) => capturados.push(e), () => '2026-01-01T00:00:00.000Z');
  log({ event: 'draft', status: 200, prompt: 'segredo', comentario: 'texto', authorization: 'Bearer x', token: 'abc' });
  assert.deepEqual(capturados, [{ event: 'draft', status: 200, at: '2026-01-01T00:00:00.000Z' }]);
});

// Configuração por ambiente.
test('19. DEV e produção têm configurações separadas, sem hardcode', () => {
  const dev = socialAIConfigFromEnvironment({ SOCIAL_AI_PORT: '8788', OLLAMA_BASE_URL: 'http://127.0.0.1:11434', OLLAMA_MODEL: 'llama3' });
  assert.equal(dev.port, 8788);
  assert.ok(dev.origins.includes('http://localhost:5173'));
  const prod = socialAIConfigFromEnvironment({ SOCIAL_AI_ALLOWED_ORIGINS: 'http://ADM-RUY:8080', OLLAMA_BASE_URL: 'http://127.0.0.1:11434', OLLAMA_MODEL: 'llama3', OLLAMA_TIMEOUT_MS: '20000' });
  assert.deepEqual([...prod.origins], ['http://ADM-RUY:8080'], 'produção serve só a origem real');
  assert.equal(prod.ollamaTimeoutMs, 20000);
  assert.equal(prod.ollamaBaseUrl, 'http://127.0.0.1:11434', 'o Ollama continua local em produção');
  const vazio = socialAIConfigFromEnvironment({});
  assert.equal(vazio.port, 8788);
  assert.equal(vazio.ollamaModel, '', 'sem modelo, a IA fica not_configured em vez de inventar');
});
test('20. buildSocialAIBackend monta tudo e falha fechado sem Postgres', async () => {
  const config = socialAIConfigFromEnvironment({ SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: 'anon-chave', OLLAMA_MODEL: 'llama3', OLLAMA_BASE_URL: 'http://127.0.0.1:11434' });
  const registros = [];
  const server = buildSocialAIBackend({ config, request: supabaseStub(), sink: (e) => registros.push(e) });
  await withServer(server, async (base) => {
    assert.equal((await call(base, '/social-ai/health')).status, 200, 'health funciona mesmo sem Postgres');
    const draft = await call(base, '/social-ai/draft', { method: 'POST', body: { commentId: 'c1' } });
    assert.equal(draft.status, 503);
    assert.equal(draft.body.message, FALLBACK_MESSAGE);
  });
  assert.ok(registros.length >= 2);
});
test('host não expõe Ollama: só duas rotas restritas', async () => {
  await withServer(backend(), async (base) => {
    for (const rota of ['/social-ai/chat', '/social-ai/models', '/social-ai/api/chat', '/', '/social-ai']) {
      assert.equal((await call(base, rota, { method: 'POST', body: { model: 'x', prompt: 'y' } })).status, 404, `rota ${rota} não deveria existir`);
    }
  });
});
test('a camada de IA não ganhou envio, worker nem chamada direta ao Ollama', async () => {
  const arquivos = ['server/social/aiBackend.mjs', 'server/social/aiHost.mjs', 'server/social/aiAuth.mjs', 'server/social/aiHandler.mjs'];
  const fontes = await Promise.all(arquivos.map((f) => readFile(new URL(`../${f}`, import.meta.url), 'utf8')));
  for (const codigo of fontes) {
    const semComentario = codigo.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const proibido of ['setInterval', "status: 'sent'", 'markSent', 'dispatchSocialOutbox']) {
      assert.ok(!semComentario.includes(proibido), `a camada de IA não pode conter ${proibido}`);
    }
    assert.ok(!semComentario.includes('11434'), 'o host não deve hardcodar a porta do Ollama');
  }
});

