// Testes do NÚCLEO de rascunhos (`src/lib/draftStore.js`).
//
// O que este arquivo protege, e por que existe:
//
// Um rascunho é a ÚNICA cópia do que o usuário digitou enquanto o registro
// oficial ainda não existe. Perder esse rascunho é perder trabalho; guardar o
// rascunho errado é pior — é o usuário A abrindo o que o usuário B escreveu no
// mesmo computador, ou um rascunho de três dias atrás sobrescrevendo o dado
// novo que alguém acabou de salvar no servidor.
//
// Por isso os testes abaixo cobrem, sempre: escrita/leitura, restauração,
// debounce, TTL, versão, isolamento por usuário, exclusão de campos
// sensíveis, recusa em serializar arquivo e degradação quando o
// localStorage não existe.
//
// Fixtures sintéticos. Nenhum dado real.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  cleanupExpiredDrafts,
  createDraftSession,
  draftKey,
  getStorage,
  hasDraftChanged,
  hasDraftContent,
  isDraftStaleAgainst,
  readDraft,
  resolveUserKey,
  sanitizeDraftData,
  subscribeExternalDrafts,
  writeDraft,
} from '../src/lib/draftStore.js';
import {
  DRAFT_DEBOUNCE_MS,
  DRAFT_PREFIX,
  DRAFT_TTL_MS,
  DRAFT_VERSION,
  DRAFT_REASONS,
} from '../src/lib/draftConfig.js';

// ---------------------------------------------------------------------------
// Dublê de localStorage
// ---------------------------------------------------------------------------

// Não existe jsdom no projeto e instalar um seria pesar a máquina por causa de
// um storage. Um dublê com a MESMA superfície é suficiente — e é explícito
// sobre o que o núcleo pode e não pode fazer.
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    _map: map,
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
  };
}

// Storage que estoura a cota, como um navegador com localStorage cheio.
function quotaStorage() {
  const base = fakeStorage();
  base.setItem = () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };
  return base;
}

// Storage inacessível, como localStorage bloqueado por política do navegador.
function brokenStorage() {
  return { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('SecurityError'); }, removeItem: () => {} };
}

const USER_A = { id: 11, auth_user_id: 'uuid-a', email: 'a@empresa.com' };
const USER_B = { id: 22, auth_user_id: 'uuid-b', email: 'b@empresa.com' };
const GASTO = 'financeiro:gasto:new';

const KEY_A = draftKey(resolveUserKey(USER_A), GASTO);

// ---------------------------------------------------------------------------

test('D01 — grava e relê o rascunho com o envelope completo', () => {
  const storage = fakeStorage();
  const write = writeDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, data: { description: 'Queijo', amount: 120 }, storage, now: 1000 });
  assert.equal(write.ok, true, 'a gravação de um rascunho simples deve funcionar');

  const read = readDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: 1000 });
  assert.equal(read.ok, true, 'o que foi gravado tem de voltar na leitura');
  assert.equal(read.draft.data.description, 'Queijo', 'o conteúdo do formulário volta intacto');
  assert.equal(read.draft.data.amount, 120, 'número volta como número, não como texto');
  assert.equal(read.draft.version, DRAFT_VERSION, 'o envelope carrega a versão do schema');
  assert.equal(read.draft.formKey, GASTO, 'o envelope carrega a chave do formulário');
  assert.equal(read.draft.userKey, resolveUserKey(USER_A), 'o envelope carrega o usuário');
  assert.equal(read.draft.updatedAt, 1000, 'o envelope carrega o instante da gravação');
});

test('D02 — rascunho inexistente é "missing", não erro', () => {
  const read = readDraft({ userKey: resolveUserKey(USER_A), formKey: 'nao-existe', storage: fakeStorage() });
  assert.equal(read.ok, false, 'não havendo rascunho não há o que restaurar');
  assert.equal(read.reason, DRAFT_REASONS.MISSING, 'formulário em branco não é falha');
});

test('D03 — restaura o rascunho sobre o baseline sem inventar campo', () => {
  const storage = fakeStorage();
  writeDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, data: { description: 'Gás', amount: 80, campo_fantasma: 'x' }, storage, now: 1000 });

  const session = createDraftSession({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: () => 2000 });
  const base = { description: '', amount: '', observation: '' };
  const result = session.restore({ base });

  assert.equal(result.restored, true, 'havendo rascunho válido ele é restaurado');
  assert.equal(result.data.description, 'Gás', 'campo preenchido volta');
  assert.equal(result.data.observation, '', 'campo que o rascunho não tem continua no baseline');
  assert.equal('obsFantasma' in result.data, false, 'o rascunho NÃO cria campo que o formulário não tem');
});

test('D04 — debounce: não grava antes de vencer, grava depois', () => {
  const storage = fakeStorage();
  let clock = 0;
  const session = createDraftSession({
    userKey: resolveUserKey(USER_A), formKey: GASTO, storage, debounceMs: 500,
    now: () => clock,
  });

  session.change({ description: 'Q' }, clock);
  assert.equal(storage.getItem(KEY_A), null, 'digitar não pode escrever no storage a cada tecla');

  clock = 400;
  assert.equal(session.flush(clock), false, 'antes do prazo nada é gravado');
  assert.equal(storage.getItem(KEY_A), null, 'ainda dentro da janela de debounce, storage intocado');

  clock = 500;
  assert.equal(session.flush(clock), true, 'vencido o debounce, o rascunho é gravado');
  assert.ok(storage.getItem(KEY_A), 'o rascunho está no storage depois do debounce');
});

test('D05 — remontar o formulário (nova instância) restaura o rascunho', () => {
  const storage = fakeStorage();
  const primeira = createDraftSession({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: () => 100 });
  primeira.change({ description: 'Manutenção' }, 100);
  primeira.flush(5000, { force: true });
  // a instância "desmonta" e nada mais é feito com ela

  const segunda = createDraftSession({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: () => 9000 });
  const result = segunda.restore({ base: { description: '', observation: '' } });
  assert.equal(result.restored, true, 'a nova montagem precisa reencontrar o rascunho');
  assert.equal(result.data.description, 'Manutenção', 'o texto digitado antes do desmontagem sobrevive');
});

test('D06 — F5 simulado: storage sobrevive, sessão nova lê o mesmo conteúdo', () => {
  const storage = fakeStorage();
  const antes = createDraftSession({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: () => 10 });
  antes.change({ description: 'Antes do F5' }, 10);
  antes.flush(10, { force: true });

  // F5 = o JS recarrega do zero. O dublê de storage representa o navegador,
  // que NÃO é destruído no F5 — é exatamente esse o requisito.
  const depois = createDraftSession({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: () => 20 });
  const result = depois.restore({ base: { description: '' } });
  assert.equal(result.data.description, 'Antes do F5', 'após F5 o formulário volta preenchido');
});

test('D07 — só o sucesso do backend limpa o rascunho', () => {
  const storage = fakeStorage();
  const session = createDraftSession({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: () => 1 });
  session.change({ description: 'Salvar no banco' }, 1);
  session.flush(1, { force: true });

  session.saved(); // chamado só DEPOIS do await do backend
  assert.equal(storage.getItem(KEY_A), null, 'confirmado no servidor, o rascunho sai');
});

test('D08 — falha do backend mantém o rascunho', () => {
  const storage = fakeStorage();
  const session = createDraftSession({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: () => 1 });
  session.change({ description: 'Não salvou' }, 1);
  session.flush(1, { force: true });

  session.failed(); // o servidor recusou
  assert.ok(storage.getItem(KEY_A), 'se o backend falhou o rascunho é a ÚNICA cópia e não pode sumir');
  const relido = readDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: 1 });
  assert.equal(relido.draft.data.description, 'Não salvou', 'o texto continua recuperável depois do erro');
});

test('D09 — cancelar com "manter" preserva o rascunho', () => {
  const storage = fakeStorage();
  const session = createDraftSession({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: () => 1 });
  session.change({ description: 'Continuar depois' }, 1);
  session.keep();
  assert.ok(storage.getItem(KEY_A), 'cancelar escolhendo manter não pode apagar nada');
  const relido = readDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: 1 });
  assert.equal(relido.draft.data.description, 'Continuar depois', 'o conteúdo está lá para a próxima abertura');
});

test('D10 — cancelar com "descartar" apaga o rascunho', () => {
  const storage = fakeStorage();
  const session = createDraftSession({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: () => 1 });
  session.change({ description: 'Isso foi' }, 1);
  session.discard();
  assert.equal(storage.getItem(KEY_A), null, 'descartar é a única ação que remove o rascunho');
  assert.equal(session.pending, false, 'descartar também limpa a fila de gravação pendente');
});

test('D11 — TTL dentro da validade restaura', () => {
  const storage = fakeStorage();
  writeDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, data: { description: 'Recente' }, storage, now: 1000 });
  const dentroDaValidade = 1000 + DRAFT_TTL_MS - 1;
  const read = readDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: dentroDaValidade });
  assert.equal(read.ok, true, `rascunho com menos de ${DRAFT_TTL_MS}ms deve continuar válido`);
});

test('D12 — TTL vencido expira e remove sem restaurar', () => {
  const storage = fakeStorage();
  writeDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, data: { description: 'Antigo' }, storage, now: 1000 });
  const depois = 1000 + DRAFT_TTL_MS + 1;
  const read = readDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: depois });
  assert.equal(read.ok, false, 'passado o TTL o rascunho não volta');
  assert.equal(read.reason, DRAFT_REASONS.EXPIRED, 'o motivo é expiração, não erro');
  assert.equal(storage.getItem(KEY_A), null, 'expirado é removido, não fica morando no storage');
});

test('D13 — versão incompatível não é restaurada e é removida', () => {
  const storage = fakeStorage();
  writeDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, data: { description: 'V1' }, storage, now: 1000 });
  const storage2 = fakeStorage({ [KEY_A]: JSON.stringify({ ...JSON.parse(storage.getItem(KEY_A)), version: DRAFT_VERSION + 1 }) });

  const read = readDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage: storage2, now: 2000 });
  assert.equal(read.ok, false, 'schema diferente não pode ser interpretado às cegas');
  assert.equal(read.reason, DRAFT_REASONS.INCOMPATIBLE_VERSION, 'o motivo é incompatibilidade de versão');
  assert.equal(storage2.getItem(KEY_A), null, 'a versão antiga é descartada em vez de acumulada');
});

test('D14 — JSON inválido não quebra o formulário e é removido', () => {
  const storage = fakeStorage({ [KEY_A]: '{isso não é json' });
  const session = createDraftSession({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: () => 1 });
  const base = { description: '' };
  const result = session.restore({ base });
  assert.equal(result.restored, false, 'rascunho corrompido não é aplicado');
  assert.equal(result.data, base, 'o formulário abre com o baseline normalmente, sem tela branca');
  assert.equal(storage.getItem(KEY_A), null, 'o registro corrompido sai do storage');
});

test('D15 — usuário A não enxerga o rascunho do usuário B', () => {
  const storage = fakeStorage();
  writeDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, data: { description: 'Segredo do A' }, storage, now: 1000 });
  writeDraft({ userKey: resolveUserKey(USER_B), formKey: GASTO, data: { description: 'Segredo do B' }, storage, now: 1000 });

  const a = readDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: 1000 });
  const b = readDraft({ userKey: resolveUserKey(USER_B), formKey: GASTO, storage, now: 1000 });
  assert.equal(a.draft.data.description, 'Segredo do A', 'A lê o próprio rascunho');
  assert.equal(b.draft.data.description, 'Segredo do B', 'B lê o próprio rascunho');
  assert.notEqual(a.key, b.key, 'as chaves são distintas por usuário no mesmo navegador');
});

test('D15b — sem identificador de usuário o rascunho é desligado (não vira balde compartilhado)', () => {
  assert.equal(resolveUserKey({ email: 'sem-id@empresa.com' }), null, 'e-mail não serve: o próprio app usa e-mail como fallback de nome');
  const write = writeDraft({ userKey: null, formKey: GASTO, data: { description: 'x' }, storage: fakeStorage() });
  assert.equal(write.ok, false, 'sem usuário não há gravação');
  assert.equal(write.reason, DRAFT_REASONS.NO_USER, 'o motivo é ausência de usuário, não falha de storage');
});

test('D16 — dois formulários diferentes não colidem', () => {
  const storage = fakeStorage();
  writeDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, data: { description: 'gasto' }, storage, now: 1000 });
  writeDraft({ userKey: resolveUserKey(USER_A), formKey: 'rh:colaborador:new', data: { name: 'colaborador' }, storage, now: 1000 });

  const gasto = readDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: 1000 });
  const colab = readDraft({ userKey: resolveUserKey(USER_A), formKey: 'rh:colaborador:new', storage, now: 1000 });
  assert.equal(gasto.draft.data.description, 'gasto', 'o rascunho do gasto não foi sobrescrito pelo de colaboradores');
  assert.equal(colab.draft.data.name, 'colaborador', 'o rascunho de colaboradores é o dele');
});

test('D17 — ids diferentes em edição não colidem', () => {
  const storage = fakeStorage();
  const base = 'rh:colaborador';
  writeDraft({ userKey: resolveUserKey(USER_A), formKey: `${base}:7`, data: { sector: 'Cozinha' }, storage, now: 1000 });
  writeDraft({ userKey: resolveUserKey(USER_A), formKey: `${base}:9`, data: { sector: 'Caixa' }, storage, now: 1000 });

  const sete = readDraft({ userKey: resolveUserKey(USER_A), formKey: `${base}:7`, storage, now: 1000 });
  const nove = readDraft({ userKey: resolveUserKey(USER_A), formKey: `${base}:9`, storage, now: 1000 });
  assert.equal(sete.draft.data.sector, 'Cozinha', 'editar o colaborador 7 não enxerga o rascunho do 9');
  assert.equal(nove.draft.data.sector, 'Caixa', 'cada registro editado tem rascunho próprio');
});

test('D18 — campo excluído por configuração não é persistido', () => {
  const storage = fakeStorage();
  writeDraft({
    userKey: resolveUserKey(USER_A),
    formKey: 'rh:colaborador:new',
    data: { name: 'João', cpf: '123.456.789-00', pix_key: 'joao@bank', salary: 5000 },
    excludeFields: ['cpf', 'pix_key', 'salary'],
    storage,
    now: 1000,
  });
  const read = readDraft({ userKey: resolveUserKey(USER_A), formKey: 'rh:colaborador:new', storage, now: 1000 });
  assert.equal(read.draft.data.name, 'João', 'o preenchimento normal do formulário é preservado');
  assert.equal('cpf' in read.draft.data, false, 'CPF é dado sensível e não vai para o disco do navegador');
  assert.equal('pix_key' in read.draft.data, false, 'chave Pix é dado bancário e não vai para o storage');
  assert.equal('salary' in read.draft.data, false, 'salário é dado sensível e não vai para o storage');
});

test('D18b — token e senha são barrados mesmo sem excludeFields (defesa em profundidade)', () => {
  const { data } = sanitizeDraftData({ name: 'ok', token: 'abc', password: '123', api_key: 'k', saving: true });
  assert.equal(data.name, 'ok', 'o campo legítimo permanece');
  for (const proibido of ['token', 'password', 'api_key', 'saving']) {
    assert.equal(proibido in data, false, `${proibido} nunca pode ser gravado, mesmo sem configuração do formulário`);
  }
});

test('D19 — File e Blob nunca são serializados', () => {
  // Um File real exigiria DOM; o mesmo caminho de recusa é exercitado com
  // qualquer objeto não-plano (que é o que File/Blob são para o typeof-based
  // deste núcleo) e com o caso explícito quando o ambiente os oferece.
  const comBlob = { name: 'Anexo', arquivo: new globalThis.Blob(['x']), blobUrl: 'blob:http://x/1' };
  const { data, dropped } = sanitizeDraftData(comBlob);
  assert.equal(data.name, 'Anexo', 'o resto do formulário sobrevive');
  assert.equal('arquivo' in data, false, 'Blob não vira JSON dentro do rascunho');
  assert.equal(dropped.includes('arquivo'), true, 'o descarte é registrado para a UI poder avisar');

  if (typeof globalThis.File !== 'undefined') {
    const arquivo = new globalThis.File(['x'], 'comprovante.pdf', { type: 'application/pdf' });
    const r = sanitizeDraftData({ name: 'B', proof: arquivo });
    assert.equal('proof' in r.data, false, 'File não é serializado em JSON');
  }

  // Subclasses e objetos de biblioteca também caem fora.
  class Cliente { constructor() { this.host = 'x'; } }
  const semClasse = sanitizeDraftData({ nome: 'C', client: new Cliente(), fn: () => {}, s: Symbol('x') });
  assert.equal('client' in semClasse.data, false, 'cliente/SDK não é dado de formulário');
  assert.equal('fn' in semClasse.data, false, 'função não é serializável');
  assert.equal('s' in semClasse.data, false, 'símbolo não é serializável');
});

test('D20 — localStorage indisponível degrada sem quebrar nada', () => {
  assert.equal(getStorage(null), null, 'sem storage, o núcleo reporta ausência em vez de estourar');

  const semUser = createDraftSession({ userKey: null, formKey: GASTO, storage: fakeStorage() });
  assert.equal(semUser.enabled, false, 'sem usuário a sessão nem liga');
  const base = { description: '' };
  assert.equal(semUser.restore({ base }).data, base, 'mesmo desabilitado, o formulário recebe o baseline');

  const bloqueado = createDraftSession({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage: brokenStorage() });
  const r = bloqueado.restore({ base });
  assert.equal(r.restored, false, 'storage que lança exceção não pode derrubar o formulário');
  assert.equal(r.data, base, 'o app continua funcionando normalmente');

  const cota = writeDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, data: { a: 1 }, storage: quotaStorage() });
  assert.equal(cota.ok, false, 'cota estourada é degradação, não crash');
  assert.equal(cota.reason, DRAFT_REASONS.QUOTA, 'o motivo é cota');
});

test('D21 — latest-write-wins entre duas abas', () => {
  const storage = fakeStorage();
  const abaUm = createDraftSession({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: () => 100 });
  const abaDois = createDraftSession({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: () => 200 });

  abaUm.change({ description: 'escrito primeiro' }, 100);
  abaUm.flush(100, { force: true });
  abaDois.change({ description: 'escrito por último' }, 200);
  abaDois.flush(200, { force: true });

  const final = readDraft({ userKey: resolveUserKey(USER_A), formKey: GASTO, storage, now: 200 });
  assert.equal(final.draft.data.description, 'escrito por último', 'a última escrita vence, sem sistema de colaboração');

  // E o evento `storage` avisa a outra aba sem que ela precise recarregar.
  const alvos = [];
  const ouvinte = { addEventListener: (t, cb) => { ouvinte._cb = cb; }, removeEventListener: () => {} };
  const parar = subscribeExternalDrafts((e) => alvos.push(e), { storage: null, eventTarget: ouvinte });
  ouvinte._cb({ key: KEY_A, newValue: '{"outra":1}' });
  assert.equal(alvos.length, 1, 'a outra aba é avisada de que o rascunho mudou');
  assert.equal(alvos[0].key, KEY_A, 'o aviso traz a chave afetada');
  parar();

  // Chave de outro site não gera aviso: só o prefixo do projeto importa.
  ouvinte._cb({ key: 'outro_app:qualquer:coisa', newValue: '{}' });
  assert.equal(alvos.length, 1, 'storage de outro aplicativo não é observado');
});

test('D22 — a limpeza de expirados só toca o prefixo deste projeto', () => {
  const storage = fakeStorage({
    'outro_app:config': 'sagrado',
    'gr_local_users': '{"a":1}',
    'gr:draft:u-11:financeiro:gasto:new': JSON.stringify({ version: DRAFT_VERSION, formKey: 'financeiro:gasto:new', userKey: 'u-11', updatedAt: 1000, data: { a: 1 } }),
    'gr:draft:u-11:rh:colaborador:new': JSON.stringify({ version: DRAFT_VERSION + 9, formKey: 'rh:colaborador:new', userKey: 'u-11', updatedAt: 2000, data: { a: 1 } }),
    'gr:draft:u-11:estoque:item:new': '{quebrado',
  });
  const agora = 1000 + DRAFT_TTL_MS + 10;

  const r = cleanupExpiredDrafts({ storage, now: agora });
  assert.equal(r.removed, 3, 'expirado, versão incompatível e JSON quebrado saem juntos');
  assert.equal(storage.getItem('outro_app:config'), 'sagrado', 'storage de outro aplicativo NÃO é tocado');
  assert.equal(storage.getItem('gr_local_users'), '{"a":1}', 'chave legada do próprio app fora do prefixo de draft NÃO é tocada');
  assert.equal(storage.getItem('gr:draft:u-11:financeiro:gasto:new'), null, 'o rascunho expirado saiu');

  // Limitado a um usuário, não encosta no rascunho do colega.
  const storage2 = fakeStorage({
    'gr:draft:u-11:rh:colaborador:new': JSON.stringify({ version: DRAFT_VERSION, formKey: 'rh:colaborador:new', userKey: 'u-11', updatedAt: 1000, data: {} }),
    'gr:draft:u-22:rh:colaborador:new': JSON.stringify({ version: DRAFT_VERSION, formKey: 'rh:colaborador:new', userKey: 'u-22', updatedAt: 1000, data: {} }),
  });
  cleanupExpiredDrafts({ storage: storage2, userKey: 'u-11', now: agora });
  assert.equal(storage2.getItem('gr:draft:u-11:rh:colaborador:new'), null, 'o rascunho do usuário 11 foi limpo');
  assert.ok(storage2.getItem('gr:draft:u-22:rh:colaborador:new'), 'o rascunho do usuário 22 é de outra pessoa e fica');
});

test('D23 — rascunho possivelmente antigo não sobrescreve registro novo do backend', () => {
  const storage = fakeStorage();
  const draftAntigo = { updatedAt: new Date('2026-01-01T10:00:00Z').getTime() };
  const backendNovo = '2026-01-01T12:00:00Z';

  assert.equal(isDraftStaleAgainst(draftAntigo, backendNovo), true, 'backend mais novo que o rascunho => desatualizado');
  assert.equal(isDraftStaleAgainst({ updatedAt: new Date('2026-01-01T14:00:00Z').getTime() }, backendNovo), false, 'rascunho mais novo que o backend vale');

  const session = createDraftSession({ userKey: resolveUserKey(USER_A), formKey: 'rh:colaborador:7', storage, now: () => draftAntigo.updatedAt });
  writeDraft({ userKey: resolveUserKey(USER_A), formKey: 'rh:colaborador:7', data: { sector: 'Antigo' }, storage, now: draftAntigo.updatedAt });
  const base = { sector: 'Serviço' };
  const result = session.restore({ base, recordUpdatedAt: backendNovo });

  assert.equal(result.stale, true, 'o caso é sinalizado como desatualizado');
  assert.equal(result.restored, false, 'NÃO se restaura automaticamente por cima de dado mais novo');
  assert.equal(result.data, base, 'o formulário abre com o dado do backend intacto');
  assert.ok(storage.getItem('gr:draft:u-11:rh:colaborador:7'), 'o rascunho do usuário é preservado, não apagado');
});

test('D24 — "tem preenchimento?" separa form vazio de defaults preenchidos', () => {
  assert.equal(hasDraftContent({}), false, 'formulário vazio não é preenchimento');
  assert.equal(hasDraftContent({ name: '', amount: '', observation: '' }), false, 'só strings vazias não são preenchimento');
  assert.equal(hasDraftContent({ name: 'João' }), true, 'um campo com texto é preenchimento');
  assert.equal(hasDraftContent({ amount: 12.5 }), true, 'valor digitado é preenchimento');
  assert.equal(hasDraftContent({ lines: [] }), false, 'lista vazia não é preenchimento');
  assert.equal(hasDraftContent({ lines: [{ q: 1 }] }), true, 'lista com item é preenchimento');

  // Defaults não vazios (`status:'ativo'`, `unit:'un'`) não podem enganar a
  // decisão de Cancelar. Por isso o Cancelar compara com o BASELINE exato do
  // formulário em vez de olhar campo a campo.
  const baseline = { name: '', status: 'ativo', unit: 'un', current_stock: 0 };
  assert.equal(hasDraftChanged(baseline, { ...baseline }), false, 'abrir e cancelar sem digitar não é preenchimento');
  assert.equal(hasDraftChanged({ ...baseline, name: 'João' }, baseline), true, 'digitar o nome é preenchimento');
  assert.equal(hasDraftChanged({ ...baseline, current_stock: 10 }, baseline), true, 'mexer em estoque inicial é preenchimento');
});

// ---------------------------------------------------------------------------
// Guarda de contrato: os formulários precisam usar a infraestrutura, e não
// localStorage espalhado.
// ---------------------------------------------------------------------------

test('D25 — nenhum componente escreve localStorage direto para rascunho', async () => {
  const fonte = await readFile(new URL('../src/components/shared/DraftNotice.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(fonte, /localStorage/, 'a UI de rascunho não conhece o storage — só a infraestrutura');

  const hook = await readFile(new URL('../src/lib/usePersistentDraft.js', import.meta.url), 'utf8');
  assert.doesNotMatch(hook, /localStorage\.(setItem|getItem|removeItem)/, 'o hook delega ao núcleo; não chama a API de storage');

  const core = await readFile(new URL('../src/lib/draftStore.js', import.meta.url), 'utf8');
  assert.doesNotMatch(core, /entities\.\w+\.(create|update|delete|transact)/, 'o núcleo de rascunho NUNCA escreve no banco — não existe registro incompleto durante a digitação');
});

test('D26 — configuração central: sem número mágico nos textos de rascunho', async () => {
  const config = await readFile(new URL('../src/lib/draftConfig.js', import.meta.url), 'utf8');
  assert.match(config, /export const DRAFT_DEBOUNCE_MS = 500/, 'o debounce é um número central, não um literal solto no componente');
  assert.match(config, /export const DRAFT_TTL_MS = 7 \* 24 \* 60 \* 60 \* 1000;/, 'o TTL é centralizado');
  assert.equal(DRAFT_DEBOUNCE_MS >= 300 && DRAFT_DEBOUNCE_MS <= 800, true, 'o debounce fica na faixa pedida (300–800ms)');
  assert.equal(DRAFT_TTL_MS, 7 * 24 * 60 * 60 * 1000, 'o TTL padrão é de 7 dias');
  assert.equal(DRAFT_PREFIX, 'gr:draft', 'o prefixo é o do projeto — a limpeza nunca alcança outro app');
});
