// Fase 4: a IA utilizável pela CENTRAL. Backend handler, cliente, categoria e concorrência.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSocialAIHandler } from '../server/social/aiHandler.mjs';
import { SocialAIService, SOCIAL_AI_CATEGORIES, normalizeCategory } from '../server/social/ai.mjs';
import { createSocialAIClient, createLatestRequest, AISuggestionError } from '../src/lib/social/aiClient.js';
import { socialClient } from '../src/lib/social/client.js';
import { SOCIAL_AUTOMATION } from '../server/social/outbox.mjs';
import { createSocialService } from '../server/social/service.mjs';

const FALLBACK = 'Não foi possível gerar uma sugestão. Você pode responder manualmente.';
const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const req = (path, init = {}) => new Request(`https://api.invalid${path}`, {
  headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, ...init,
});
const asUser = async () => ({ id: 'u1', active: true, app_metadata: { system_role: 'admin' } });
const post = (text) => req('/social-ai/draft', { method: 'POST', body: JSON.stringify({ text }) });
const bodyOf = async (response) => response.json();

// Handler com serviço demente: o teste observa o que a UI receberia, sem rede.
function handlerWith(service, over = {}) {
  return createSocialAIHandler({ service, verifyIdentity: asUser, ...over });
}
const stubService = (over = {}) => ({
  health: async () => ({ status: 'not_configured' }),
  classifyComment: async () => null,
  draftReply: async () => ({ reply: 'ok' }),
  ...over,
});

// 1-4. Health: os quatro estados de operação + normalização.
test('1-4. health reflete not_configured, offline, model_unavailable e ready', async () => {
  for (const status of ['not_configured', 'offline', 'model_unavailable', 'ready']) {
    const response = await handlerWith(stubService({ health: async () => ({ status, provider: 'ollama', host: '127.0.0.1', model: 'llama3' }) }))(req('/social-ai/health'));
    assert.equal(response.status, 200);
    const body = await bodyOf(response);
    assert.equal(body.status, status);
    assert.equal(body.ready, status === 'ready');
  }
});

// 5. Health não vaza segredo: URL, porta, header e resposta crua ficam de fora.
test('5. health nao vaza segredo e normaliza estado desconhecido para error', async () => {
  const vazamento = {
    status: 'ready', provider: 'ollama', host: '127.0.0.1', model: 'llama3',
    base_url: 'http://user:senha@10.0.0.5:11434', headers: { authorization: 'Bearer segredo' },
    raw: '{"error":"conexao recusada em /var/lib/ollama"}', error: 'ECONNREFUSED 10.0.0.5:11434',
  };
  const body = await bodyOf(await handlerWith(stubService({ health: async () => vazamento }))(req('/social-ai/health')));
  assert.deepEqual(Object.keys(body).sort(), ['host', 'model', 'provider', 'ready', 'status']);
  const serializado = JSON.stringify(body);
  for (const segredo of ['senha', 'segredo', 'Bearer', '10.0.0.5', '11434', '/var/lib/ollama', 'ECONNREFUSED']) {
    assert.ok(!serializado.includes(segredo), `health vazou ${segredo}`);
  }
  const desconhecido = await bodyOf(await handlerWith(stubService({ health: async () => ({ status: 'saudavel_ufa' }) }))(req('/social-ai/health')));
  assert.equal(desconhecido.status, 'error', 'estado fora da allowlist precisa virar error');
  const lancou = await handlerWith(stubService({ health: async () => { throw new Error('boom'); } }))(req('/social-ai/health'));
  assert.equal((await bodyOf(lancou)).status, 'error');
});

// Autorização: sem identidade real, fail-closed.
test('handler sem verifyIdentity ou sem identidade válida nega tudo', async () => {
  assert.equal((await createSocialAIHandler({ service: stubService() })(req('/social-ai/health'))).status, 503);
  assert.equal((await createSocialAIHandler({ service: stubService(), verifyIdentity: async () => null })(req('/social-ai/health'))).status, 401);
  assert.equal((await createSocialAIHandler({ service: stubService(), verifyIdentity: async () => ({ id: 'u', active: false }) })(req('/social-ai/health'))).status, 401);
  assert.equal((await createSocialAIHandler({ service: stubService(), verifyIdentity: async () => ({ id: 'u', active: true, app_metadata: { system_role: 'viewer' } }) })(req('/social-ai/health'))).status, 403);

// 6-9. Sucesso: texto, categoria, confiança e o indicador de humano.
test('6-9. draft bem-sucedido devolve texto, categoria e exige humano', async () => {
  const service = stubService({
    classifyComment: async () => ({ category: 'reclamacao', categoryRecognized: true, confidence: 0.9 }),
    draftReply: async () => ({ reply: 'Sentimos muito pelo transtorno, vamos verificar.', category: 'reclamacao', confidence: 0.9, safety: { level: 'high', reasons: ['reclamação'] } }),
  });
  const body = await bodyOf(await handlerWith(service)(post('Produto veio errado')));
  assert.equal(body.text, 'Sentimos muito pelo transtorno, vamos verificar.');
  assert.equal(body.category, 'reclamacao');
  assert.equal(body.requiresHuman, true);
  assert.equal(body.automaticAllowed, false);
  assert.equal(body.status, 'draft');
  assert.equal(body.safety.level, 'high');
});

// 10. Categoria fora da allowlist nunca chega crua à UI.
test('10. categoria fora da allowlist vira outro e e marcada como nao reconhecida', async () => {
  const service = stubService({
    classifyComment: async () => ({ category: 'falha nuclear do servidor', categoryRecognized: false }),
    draftReply: async () => ({ reply: 'Vamos verificar.', category: 'categoria_inventada', confidence: 5 }),
  });
  const body = await bodyOf(await handlerWith(service)(post('oi')));
  assert.equal(body.category, 'outro');
  assert.equal(body.categoryRecognized, false);
  assert.equal(body.confidence, 1, 'confianca fora de 0..1 precisa ser limitada');
  assert.ok(!JSON.stringify(body).includes('falha nuclear'));
});

test('categoria valida e preservada, com e sem acento ou caixa', () => {
  for (const entrada of ['elogio', 'ELOGIO', 'Elogio', 'Dúvida', 'DUVIDA', 'problema_pedido', 'Problema Pedido']) {
    assert.equal(normalizeCategory(entrada).recognized, true, `deveria reconhecer ${entrada}`);
    assert.ok(SOCIAL_AI_CATEGORIES.includes(normalizeCategory(entrada).category));
  }
  for (const lixo of ['', null, undefined, 'xyz', 42, {}, 'categoria_inventada']) {
    assert.deepEqual(normalizeCategory(lixo), { category: 'outro', recognized: false });
  }
});

// 11. requires_human é política soberana: o modelo não libera, mesmo dizendo false.
test('11. requires_human e soberano: provider dizendo false ainda exige humano', async () => {
  const service = new SocialAIService({
    provider: {
      classifyComment: async () => ({ category: 'elogio', confidence: 1, requiresHuman: false }),
      draftReply: async () => ({ reply: 'Obrigado!', category: 'elogio', confidence: 1, requiresHuman: false }),
    },
  });
  const classificacao = await service.classifyComment({ text: 'Adorei o produto' });
  assert.equal(classificacao.requiresHuman, true);
  assert.equal(classificacao.automaticAllowed, false);
  assert.equal((await service.draftReply({ text: 'Adorei o produto' })).requiresHuman, true);
  const body = await bodyOf(await handlerWith(service)(post('Adorei o produto')));
  assert.equal(body.requiresHuman, true);
  assert.equal(body.automaticAllowed, false);
});

test('caso sensivel continua exigindo humano mesmo classificado como elogio', async () => {
  const service = new SocialAIService({
    provider: {
      classifyComment: async () => ({ category: 'elogio', confidence: 0.99, requiresHuman: false }),
      draftReply: async () => ({ reply: 'ok', category: 'elogio', requiresHuman: false }),
    },
  });
  const r = await service.classifyComment({ text: 'Quero reembolso e meu CPF é 123.456.789-00' });
  assert.equal(r.requiresHuman, true);
  assert.equal(r.automaticAllowed, false);
  // O contrato real de `moderationCheck` é `{requiresHuman, automaticAllowed,
  // requiresAttention, sensitive, policyVersion}` — NÃO tem `level`. O teste
  // antigo exigia `safety.level`, campo que o código nunca produziu (verificado
  // por `git log -S "level" -- server/social/ai.mjs`, sem resultado, desde o
  // commit de origem 8664611). A intenção do teste é a mesma: conteúdo
  // sensível precisa ser marcado e nunca liberado para resposta automática.
  assert.equal(r.safety.sensitive, true, 'texto com CPF deveria ser sensivel');
  assert.equal(r.safety.requiresAttention, true, 'sensivel exige atencao');
  assert.equal(r.safety.requiresHuman, true);
  assert.equal(r.safety.automaticAllowed, false);
});

});

// 12-14. Limite, vazio e timeout: todos caem no fallback manual.
test('12-14. draft acima do limite, vazio e timeout caem no fallback manual', async () => {
  const grande = await bodyOf(await handlerWith(stubService({ draftReply: async () => ({ reply: 'x'.repeat(2001) }) }))(post('oi')));
  assert.equal(grande.message, FALLBACK);
  const vazio = await bodyOf(await handlerWith(stubService({ draftReply: async () => ({ reply: '   ' }) }))(post('oi')));
  assert.equal(vazio.message, FALLBACK);
  const respostaTimeout = await handlerWith(stubService({ draftReply: async () => { throw Object.assign(new Error('timeout em 10.0.0.5:11434'), { code: 'AI_TIMEOUT' }); } }))(post('oi'));
  assert.equal(respostaTimeout.status, 503);
  const timeout = await bodyOf(respostaTimeout);
  assert.equal(timeout.message, FALLBACK);
  assert.equal(timeout.error, 'offline');
  assert.ok(!JSON.stringify(timeout).includes('10.0.0.5'), 'a mensagem do provider nao pode vazar');
  // Limite exato e aceito; 2001 e barrado tambem pelo proprio servico.
  const limite = new SocialAIService({ provider: { draftReply: async () => ({ reply: 'y'.repeat(2000) }) } });
  assert.equal((await limite.draftReply({ text: 'oi' })).reply.length, 2000);
  await assert.rejects(new SocialAIService({ provider: { draftReply: async () => ({ reply: 'y'.repeat(2001) }) } }).draftReply({ text: 'oi' }), { code: 'AI_UNSAFE_OUTPUT' });
  await assert.rejects(new SocialAIService({ provider: { draftReply: async () => ({ reply: null }) } }).draftReply({ text: 'oi' }), { code: 'AI_INVALID_RESPONSE' });
});

// 15. Resposta invalida nao quebra a UI nem polui o fallback.
test('15. resposta invalida, JSON quebrado, metodo e rota nao quebram a UI', async () => {
  const invalida = await bodyOf(await handlerWith(stubService({ draftReply: async () => ({ reply: 123 }) }))(post('oi')));
  assert.equal(invalida.message, FALLBACK);
  assert.equal((await handlerWith(stubService())(req('/social-ai/draft', { method: 'POST', body: '{nao e json' }))).status, 400);
  assert.equal((await handlerWith(stubService())(req('/social-ai/draft'))).status, 405);
  assert.equal((await handlerWith(stubService())(req('/social-ai/health', { method: 'POST' }))).status, 405);
  assert.equal((await handlerWith(stubService())(req('/outra'))).status, 404);
  assert.equal((await handlerWith(stubService())(req('/social-ai/draft', { method: 'POST', body: JSON.stringify({ text: '   ' }) }))).status, 400);
});

// 16. Clique duplo barrado: uma requisicao por vez.
test('16. clique duplo e barrado pelo cliente: uma requisicao por vez', async () => {
  let chamadas = 0;
  const cliente = createSocialAIClient({ endpoint: 'https://api.invalid', fetchImpl: async () => { chamadas += 1; return ok({ text: 'sugestao' }); } });
  const primeira = cliente.suggest({ id: 'c1', text: 'oi' });
  const segunda = cliente.suggest({ id: 'c1', text: 'oi' });
  await assert.rejects(segunda, (e) => e.code === 'superseded');
  await primeira;
  assert.equal(chamadas, 1, 'o segundo clique nao pode disparar outra chamada');
});

// 17. Resposta antiga nao sobrescreve a nova (latest-wins).
test('17. resposta antiga nao sobrescreve a nova (latest-wins)', async () => {
  const liberadas = [];
  const cliente = createSocialAIClient({
    endpoint: 'https://api.invalid',
    fetchImpl: (url, init) => new Promise((resolve) => { liberadas.push(() => resolve(ok({ text: 'resposta' }))); init.signal.addEventListener('abort', () => { const e = new Error('abortado'); e.name = 'AbortError'; resolve(ok({ _err: e })); }); }),
  });
  const antiga = cliente.suggest({ id: 'c1', text: 'oi' }).catch(e => e.code);
  const nova = cliente.suggest({ id: 'c1', text: 'oi' });
  assert.equal(cliente.busy, true, 'o cliente precisa reportar loading durante a requisicao');
  assert.equal(await antiga, 'superseded', 'a requisicao abortada vira no-op, nao erro visivel');
  liberadas.at(-1)();
  assert.equal((await nova).text, 'resposta');
  assert.equal(cliente.busy, false);
  const sequencial = createLatestRequest();
  const a = sequencial.begin();
  const b = sequencial.begin();
  assert.equal(sequencial.accept(a.id), false, 'resposta antiga e rejeitada');
  assert.equal(sequencial.accept(b.id), true);
});

// 18-19. Aprovacao humana e outbox pendente.
test('18-19. aprovacao continua humana, versionada e com outbox pendente', async () => {
  const chamadas = [];
  const repository = {
    canAccessAccount: async () => true,
    commentFor: async () => ({ id: 'c1', version: 1, transport: 'instagram', channel: 'instagram', text: 'oi' }),
    appendDraftAndEvent: async (d) => { chamadas.push(d); return d; },
    enqueueOutbox: async (e) => { chamadas.push(e); return e; },
  };
  const service = createSocialService({ repository, verifyIdentity: async () => ({ id: 'u1', active: true, app_metadata: { system_role: 'admin' } }) });
  await assert.rejects(service.approveAndReply('t', { commentId: 'c1', text: 'respondido', expectedVersion: 1 }), { code: 'REVIEW_REQUIRED' }, 'sem confirmar humano, nao aprova');
  const aprovado = await service.approveAndReply('t', { commentId: 'c1', text: 'respondido', confirmHuman: true, expectedVersion: 1 });
  assert.equal(aprovado.status, 'pending', 'a resposta aprovada entra na outbox como pendente');
  assert.equal(SOCIAL_AUTOMATION.enabled, false, 'automacao continua desligada');
  assert.ok(!chamadas.some(c => c.status === 'sent'), 'nada pode sair como enviado');
});

// 20. Nenhuma funcao de envio real existe na camada de IA.
test('20. nenhuma rota de IA envia, cria worker ou marca enviado', async () => {
  const fontes = await Promise.all(['server/social/aiHandler.mjs', 'server/social/ai.mjs', 'server/social/aiOllama.mjs', 'src/lib/social/aiClient.js', 'src/components/social/CommentPanel.jsx'].map((f) => readFile(new URL(`../${f}`, import.meta.url), 'utf8')));
  for (const codigo of fontes) {
    const semComentario = codigo.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const proibido of ['setInterval', 'dispatchSocialOutbox', 'markSent', "status: 'sent'", 'sendMessage', 'worker']) {
      assert.ok(!semComentario.includes(proibido), `a camada de IA nao pode conter ${proibido}`);
    }
  }
  assert.ok(!/function\s+\w*(send|enviar|dispatch)/i.test(fontes.join('\n')), 'nao deve existir funcao de envio na camada de IA');
});

// O botao da UI usa o backend e nunca o provider direto.
test('botao da UI usa o backend e nunca o provider direto', async () => {
  const urls = [];
  const cliente = createSocialAIClient({ endpoint: 'https://api.invalid', getToken: async () => 'token-123', fetchImpl: async (url, init) => { urls.push(url); assert.equal(init.headers.authorization, 'Bearer token-123'); return ok({ status: 'ready', ready: true, text: 's' }); } });
  await cliente.health();
  await cliente.suggest({ id: 'c9', text: 'ola' });
  assert.equal(urls[0], 'https://api.invalid/social-ai/health');
  assert.equal(urls[1], 'https://api.invalid/social-ai/draft');
  assert.ok(!urls.some(u => /ollama|11434|gemini|groq/i.test(u)), 'a UI jamais fala com o provider');
});

test('cliente sem endpoint falha fechado e health degrada sem lancar', async () => {
  const cliente = createSocialAIClient({});
  assert.equal((await cliente.health()).status, 'not_configured');
  await assert.rejects(cliente.suggest({ id: 'c1', text: 'oi' }), (e) => e instanceof AISuggestionError && e.message === FALLBACK);
  assert.equal(socialClient.draftReply.length, 0, 'o client legado continua recusando geracao');
  const caido = createSocialAIClient({ endpoint: 'https://api.invalid', fetchImpl: async () => { throw new Error('rede caiu'); } });
  assert.deepEqual(await caido.health(), { status: 'error', ready: false, provider: null, host: null, model: null });
});

test('health da UI reflete cada estado', async () => {
  for (const status of ['not_configured', 'offline', 'model_unavailable', 'ready', 'error']) {
    const cliente = createSocialAIClient({ endpoint: 'https://api.invalid', fetchImpl: async () => ok({ status, ready: status === 'ready' }) });
    assert.equal((await cliente.health()).status, status);
  }
});

// 14. isAccountVisible: fail-closed, sem autorizacao inventada.
test('14. isAccountVisible continua fail-closed e documentado como pendente', async () => {
  const source = await readFile(new URL('../server/social/repository.mjs', import.meta.url), 'utf8');
  assert.ok(/isAccountVisible/.test(source), 'a lacuna precisa continuar visivel no codigo');
  const semAntropico = source.replace(/isAccountVisible[\s\S]{0,200}/, '');
  assert.ok(/TODO|not implemented|nao implementad|pending/i.test(semAntropico), 'a lacuna precisa estar marcada como pendente, nao escondida');
  const handler = createSocialAIHandler({ service: stubService(), verifyIdentity: asUser });
  assert.equal((await handler(post('oi'))).status, 200, 'sem loadComment, o handler nao inventa autorizacao de conta');
});

test('loadComment e a fonte do texto e nega acesso quando falha', async () => {
  const vistos = [];
  const service = stubService({ classifyComment: async (c) => { vistos.push(c.text); return null; }, draftReply: async (c) => { vistos.push(c.text); return { reply: 'ok' }; } });
  const handler = handlerWith(service, { loadComment: async (id) => (id === 'c1' ? { text: 'texto persistido', category: 'elogio' } : null) });
  const achou = await bodyOf(await handler(req('/social-ai/draft', { method: 'POST', body: JSON.stringify({ commentId: 'c1', text: 'texto forjado pelo cliente' }) })));
  assert.equal(achou.text, 'ok');
  assert.deepEqual(vistos, ['texto persistido', 'texto persistido'], 'o corpo do cliente nao substitui o conteudo persistido');
  assert.equal((await handler(req('/social-ai/draft', { method: 'POST', body: JSON.stringify({ commentId: 'inexistente', text: 'oi' }) }))).status, 404);
  const negado = handlerWith(service, { loadComment: async () => { throw new Error('sem acesso a conta'); } });
  assert.equal((await negado(req('/social-ai/draft', { method: 'POST', body: JSON.stringify({ commentId: 'c1', text: 'oi' }) }))).status, 403);
});

test('nenhum segredo de Ollama no frontend', async () => {
  const arquivos = ['src/lib/social/aiClient.js', 'src/lib/social/aiCategories.js', 'src/components/social/CommentPanel.jsx', 'src/components/social/SocialWorkspace.jsx'];
  const todo = (await Promise.all(arquivos.map((f) => readFile(new URL(`../${f}`, import.meta.url), 'utf8')))).join('\n');
  for (const proibido of ['VITE_OLLAMA', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL', 'OLLAMA_API_KEY', '11434']) {
    assert.ok(!todo.includes(proibido), `frontend nao pode conter ${proibido}`);
  }
});

test('a UI mantem os tres botoes e nunca offers envio automatico', async () => {
  const painel = await readFile(new URL('../src/components/social/CommentPanel.jsx', import.meta.url), 'utf8');
  for (const botao of ['Gerar sugestão com IA', 'Editar', 'Gerar novamente']) {
    assert.ok(painel.includes(botao), `falta o botao ${botao}`);
  }
  assert.ok(painel.includes('Gerando sugestão...'), 'falta o estado de loading');
  assert.ok(painel.includes('Requer humano'), 'falta o indicador de humano');
  assert.ok(!/Enviar automaticamente|Enviar resposta|Enviar agora/.test(painel), 'nao pode existir envio automatico na UI');
  assert.ok(painel.includes('Aprovar e responder'), 'a aprovacao humana precisa continuar');
});

