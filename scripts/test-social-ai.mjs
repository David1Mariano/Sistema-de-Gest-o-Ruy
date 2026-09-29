// Testes da camada de IA local. Rede bloqueada globalmente: qualquer fetch
// real aqui e falha, nao ruido.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { OllamaAIProvider, ollamaFromEnvironment, assertSafeBaseUrl } from '../server/social/aiOllama.mjs';
import { GeminiAIProvider, GroqAIProvider, cloudFromEnvironment } from '../server/social/aiCloud.mjs';
import { SocialAIService, socialAIFromEnvironment, buildContext, moderationCheck, SOCIAL_AI_CONTEXT } from '../server/social/ai.mjs';
import { providers, transports, TRANSPORT_ROLES } from '../server/social/providers.mjs';

let networkCalls = 0;
globalThis.fetch = async () => { networkCalls += 1; throw new Error('NETWORK_DISABLED_IN_SOCIAL_AI_TESTS'); };
test.after(() => assert.equal(networkCalls, 0, 'nenhuma chamada de rede real durante os testes'));

const abs = rel => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const read = rel => readFile(abs(rel), 'utf8');

const ENV = { OLLAMA_BASE_URL: 'http://localhost:11434', OLLAMA_MODEL: 'llama3.1:8b' };
// O construtor recebe `baseUrl`/`model`; ENV e a forma de ambiente. Sao
// nomes diferentes de proposito, e os dois caminhos sao testados.
const OPTS = { baseUrl: ENV.OLLAMA_BASE_URL, model: ENV.OLLAMA_MODEL };

/** Responde como o Ollama responderia, sem tocar a rede. */
function fakeOllama({ tags = ['llama3.1:8b'], chat = { message: { content: '{"category":"pergunta","confidence":0.9}' } }, chatStatus = 200 } = {}) {
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, method: init?.method || 'GET' });
    if (url.endsWith('/api/tags')) return Response.json({ models: tags.map(name => ({ name })) });
    return new Response(JSON.stringify(chat), { status: chatStatus, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, provider: new OllamaAIProvider({ ...OPTS, request }) };
}

test('1. provider nao configurado: sem base ou sem modelo nao ha chamada', async () => {
  for (const env of [{ OLLAMA_MODEL: 'llama3.1:8b' }, { OLLAMA_BASE_URL: 'http://localhost:11434' }]) {
    const p = ollamaFromEnvironment(env);
    assert.equal(p.configured, false);
    assert.deepEqual(await p.health(), { provider: 'ollama', configured: false, reachable: false, modelAvailable: false, state: 'not_configured' });
    await assert.rejects(() => p.draftReply({ text: 'oi' }), /não configurada/);
  }
  // Sem configuracao nenhuma, o servico cai no caminho manual.
  const service = new SocialAIService({ provider: null });
  await assert.rejects(() => service.classifyComment({ text: 'oi' }), /não configurada/);
});

test('2. Ollama offline: erro de rede vira estado offline, nao excecao', async () => {
  const provider = new OllamaAIProvider({ ...OPTS, request: async () => { throw new Error('ECONNREFUSED'); } });
  const h = await provider.health();
  assert.equal(h.state, 'offline');
  assert.equal(h.configured, true);
  assert.equal(h.reachable, false);
  assert.equal(h.modelAvailable, false);
  await assert.rejects(() => provider.draftReply({ text: 'oi' }), /offline/);
});

test('3. modelo ausente: servidor responde mas o modelo nao foi baixado', async () => {
  const { provider } = fakeOllama({ tags: ['outro-modelo'] });
  const h = await provider.health();
  assert.equal(h.reachable, true);
  assert.equal(h.modelAvailable, false);
  assert.equal(h.state, 'model_unavailable');
});

test('4. health OK: tres eixos verdes e sem vazar URL completa', async () => {
  const { provider } = fakeOllama();
  const h = await provider.health();
  assert.equal(h.state, 'ready');
  assert.equal(h.configured, true);
  assert.equal(h.reachable, true);
  assert.equal(h.modelAvailable, true);
  assert.equal(h.host, 'localhost:11434');
  // Nao devolve a URL completa, so o host.
  assert.ok(!JSON.stringify(h).includes('http://'));
  // E nenhum campo de credencial existe no health.
  assert.ok(!/key|token|secret|password/i.test(JSON.stringify(h)));
});

test('5. classifyComment devolve categoria do catalogo autorizado', async () => {
  const { provider, calls } = fakeOllama({ chat: { message: { content: '{"category":"pergunta","confidence":0.82}' } } });
  const out = await provider.classifyComment({ text: 'Qual o horario?', categories: ['pergunta', 'elogio', 'reclamacao'] });
  assert.equal(out.category, 'pergunta');
  assert.equal(out.confidence, 0.82);
  assert.equal(out.provider, 'ollama');
  assert.equal(calls.some(c => c.url.endsWith('/api/chat')), true);
  assert.equal('requiresHuman' in out, true);
});

test('6. draftReply devolve texto curto e nunca vira envio', async () => {
  const { provider } = fakeOllama({ chat: { message: { content: '{"reply":"Bom dia! Abrimos das 8h as 18h."}' } } });
  const out = await provider.draftReply({ text: 'Qual o horario?' });
  assert.match(out.reply, /8h/);
  assert.ok(out.reply.length <= 2000);
  // O provider nao tem metodo de envio: e o que garante, por construcao, que
  // a IA nao consiga mandar nada.
  assert.equal(typeof provider.reply, 'undefined');
  assert.equal(typeof provider.send, 'undefined');
});

test('7. moderationCheck: caso sensivel sempre exige humano', async () => {
  const casos = ['Quero meu reembolso', 'O pagamento nao caiu', 'Minha conta foi invadida', 'salario do funcionario', 'processo juridico', 'pedido errado'];
  for (const texto of casos) {
    const r = moderationCheck(texto, '');
    assert.equal(r.requiresHuman, true, texto);
    assert.equal(r.automaticAllowed, false, texto);
  }
  // Nem a IA concordando libera: quem decide e o policy.
  const service = new SocialAIService({ provider: { name: 'fake', draftReply: async () => ({ reply: 'ok', requiresHuman: false }) } });
  const r = await service.draftReply({ text: 'Quero meu reembolso', category: 'reclamacao' });
  assert.equal(r.requiresHuman, true);
  assert.equal(r.automaticAllowed, false);
  assert.equal(r.safety.sensitive, true);
});

test('8. timeout, resposta invalida e saida grande viram erro nomeado', async () => {
  // Assercao por CODIGO, nao por texto: o arquivo e lido em UTF-8 e comparar
  // acento dentro de regex e fragil. O codigo e o contrato estavel.
  const lento = new OllamaAIProvider({ ...OPTS, request: async () => { const e = new Error('demorou'); e.name = 'TimeoutError'; throw e; } });
  await assert.rejects(() => lento.draftReply({ text: 'oi' }), e => e.code === 'AI_TIMEOUT');

  const invalido = fakeOllama({ chat: { message: { content: 'isto nao e json' } } });
  await assert.rejects(() => invalido.provider.draftReply({ text: 'oi' }), e => e.code === 'AI_INVALID_RESPONSE');

  const vazio = fakeOllama({ chat: { message: { content: '{}' } } });
  await assert.rejects(() => vazio.provider.draftReply({ text: 'oi' }), e => e.code === 'AI_INVALID_RESPONSE');

  const enorme = fakeOllama({ chat: { message: { content: JSON.stringify({ reply: 'x'.repeat(3000) }) } } });
  await assert.rejects(() => enorme.provider.draftReply({ text: 'oi' }), e => e.code === 'AI_UNSAFE_OUTPUT');

  const semResposta = fakeOllama({ chatStatus: 503 });
  await assert.rejects(() => semResposta.provider.draftReply({ text: 'oi' }), e => e.code === 'AI_UNREACHABLE');
});

test('9. fallback manual: sem IA a Central continua utilizavel', async () => {
  const service = new SocialAIService({ provider: null });
  const h = await service.health();
  assert.equal(h.state, 'not_configured');
  await assert.rejects(() => service.draftReply({ text: 'oi' }), /IA n/);
  // moderationCheck e pura e segue funcionando sem provider: a rede de
  // seguranca nao pode depender da IA estar de pe.
  assert.equal((await service.moderationCheck('oi', '')).requiresHuman, true);

  // `socialAIFromEnvironment` sem `request` injetado cairia no `fetch` global —
  // por isso receives um stub local: aqui NENHUMA rede real pode acontecer.
  const caido = socialAIFromEnvironment({ OLLAMA_BASE_URL: 'http://localhost:11434', OLLAMA_MODEL: 'x' });
  caido.provider.request = async () => { throw new Error('sem rede nos testes'); };
  assert.equal((await caido.health()).configured, true);
  assert.equal(caido.status().automaticReplies, false);
});

test('10. contexto do negocio: so campo declarado passa, e sem dado sensivel', async () => {
  const contexto = buildContext({ address: 'Rua X, 100', telefonePrivado: '11 90000-0000', salary: 5000, productCategories: ['Sopa', 'Caldinho'] });
  assert.equal(contexto.address, 'Rua X, 100');
  // Campos fora da lista sao descartados.
  assert.equal('telefonePrivado' in contexto, false);
  assert.equal('salary' in contexto, false);
  assert.deepEqual(contexto.productCategories, ['Sopa', 'Caldinho']);
  // Por padrao o contexto nao carrega nada de negocio.
  assert.equal(buildContext().address, '');
  assert.equal(SOCIAL_AI_CONTEXT.openingHours, '');
});

test('11. base URL insegura e rejeitada antes de qualquer fetch', async () => {
  for (const url of ['', '   ', 'nao-e-url', 'ftp://localhost:11434', 'http://u:p@localhost:11434', 'http://localhost:11434?x=1']) {
    assert.throws(() => assertSafeBaseUrl(url), /não configurada/, url);
  }
  assert.equal(assertSafeBaseUrl('http://localhost:11434'), 'http://localhost:11434');
  assert.equal(assertSafeBaseUrl('http://127.0.0.1:11434/'), 'http://127.0.0.1:11434');
});

test('12. IA em nuvem fica desligada sem as duas chaves explicitas', async () => {
  // Chave sozinha nao liga: e o que impede colar a chave e sair cobrando.
  const soChave = cloudFromEnvironment({ GEMINI_API_KEY: 'k', GROQ_API_KEY: 'k' });
  assert.equal(soChave.gemini.cloudEnabled(), false);
  assert.equal(soChave.groq.cloudEnabled(), false);
  // Nem a flag sem chave liga.
  const soFlag = cloudFromEnvironment({ SOCIAL_AI_PROVIDER: 'gemini', SOCIAL_AI_CLOUD_FALLBACK: 'true' });
  assert.equal(soFlag.gemini.cloudEnabled(), false);
  await assert.rejects(() => soFlag.gemini.draftReply({ text: 'oi' }), /IA n/);
  // O health nunca devolve a chave.
  const h = await new GeminiAIProvider({ apiKey: 'secreta' }).health();
  assert.equal(h.configured, true);
  assert.ok(!JSON.stringify(h).includes('secreta'));
  const g = await new GroqAIProvider({ apiKey: 'outra' }).health();
  assert.ok(!JSON.stringify(g).includes('outra'));
});

test('13. nenhum endpoint Ollama e nenhuma chave no frontend', async () => {
  const arquivos = ['src/lib/social/integrations.js', 'src/lib/social/domain.js', 'src/lib/social/client.js',
    'src/components/social/ManyChatCard.jsx', 'src/components/social/CommentPanel.jsx',
    'src/components/social/SocialWorkspace.jsx', 'src/pages/RedesSociais.jsx'];
  const todo = (await Promise.all(arquivos.map(read))).join('\n');
  assert.ok(!/localhost:11434/.test(todo), 'URL do Ollama nao pode aparecer no frontend');
  assert.ok(!/\/api\/chat/.test(todo), 'endpoint do Ollama nao pode aparecer no frontend');
  assert.ok(!/OLLAMA_(BASE_URL|MODEL)/.test(todo), 'variavel do Ollama nao pode aparecer no frontend');
  assert.ok(!/VITE_OLLAMA/.test(todo), 'Ollama nunca via VITE_*');
  assert.ok(!/GEMINI_API_KEY|GROQ_API_KEY/.test(todo), 'chave de nuvem nao pode aparecer no frontend');
  // E o inverso: a URL do Ollama so e lida do ambiente do backend.
  // Comentários são removidos antes da varredura: o invariante é sobre CÓDIGO,
  // e a própria doc do arquivo cita `import.meta.env` para explicar por que
  // ele NÃO é usado.
  const semComentario = s => s.split('\n').filter(linha => !/^\s*(\/\/|\*|\/\*)/.test(linha)).join('\n');
  const backend = semComentario(await read('server/social/aiOllama.mjs'));
  assert.match(backend, /OLLAMA_BASE_URL/);
  assert.ok(!/import\.meta\.env/.test(backend), 'backend nao deve ler import.meta.env');
});

test('14. ManyChat virou integracao opcional e canal direto existe', async () => {
  // Nada foi apagado: transporte e provider continuam de pe.
  assert.equal(transports.manychat.constructor.name, 'ManyChatProvider');
  assert.equal(TRANSPORT_ROLES.manychat, 'optional');
  // E os canais diretos, independentes do ManyChat.
  for (const canal of ['instagram', 'facebook', 'whatsapp']) {
    assert.ok(providers[canal], canal);
    assert.equal(typeof providers[canal].replyComment, 'function');
  }
  const { MANYCHAT_ROLE_LABEL } = await import('../src/lib/social/integrations.js');
  assert.equal(MANYCHAT_ROLE_LABEL, 'Integração opcional');
});

test('15. outbox so aceita o que passou por humano, e a IA nao assina nada', async () => {
  const { prepareManyChatAction, SOCIAL_AUTOMATION, dispatchSocialOutbox } = await import('../server/social/outbox.mjs');
  const registrado = [];
  const repository = {
    transaction: async fn => fn({
      recordForUpdate: async () => ({ id: 'r1', account_id: 'a1', transport: 'manychat', channel: 'instagram', version: 3, text: 'oi' }),
      canAccessAccount: async () => true,
      insertOutboxOnce: async entry => { registrado.push(entry); return { created: true, entry }; },
      appendEvent: async () => {},
    }),
  };
  // Sem confirmHuman nao entra, mesmo com texto vindo da IA.
  await assert.rejects(() => prepareManyChatAction({ repository, actor: { id: 'u1' }, request: { kind: 'comment', recordId: 'r1', text: 'oi', expectedVersion: 3, idempotencyKey: '11111111-1111-4111-8111-111111111111' } }), /Revisão humana/);
  // Aprovado: entra com approved_by e status bloqueado para envio.
  const entry = await prepareManyChatAction({ repository, actor: { id: 'u1' }, request: { kind: 'comment', recordId: 'r1', text: 'oi', expectedVersion: 3, confirmHuman: true, idempotencyKey: '11111111-1111-4111-8111-111111111111' } });
  assert.equal(entry.approved_by, 'u1');
  assert.equal(entry.status, 'pending');
  assert.equal(entry.blocked_reason, 'SEND_DISABLED');
  assert.equal(SOCIAL_AUTOMATION.enabled, false);
  // E o dispatch nao existe: nao ha worker mandando nada.
  await assert.rejects(() => dispatchSocialOutbox(), /não disponível/);
});
