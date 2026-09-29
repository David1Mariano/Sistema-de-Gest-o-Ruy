// Configuração central da infraestrutura de RASCUNHOS (drafts).
//
// Tudo que é número mágico, chave de storage, tempo ou texto de usuário vive
// AQUI e em nenhum outro lugar. `draftStore.js` e `usePersistentDraft.js`
// importam deste arquivo; componentes nunca escrevem `localStorage`
// diretamente.
//
// Este módulo NÃO importa nada e NÃO usa o alias `@/`, para poder ser
// importado por `node --test` (Scripts Node não resolvem `@/`).

// Identificador do aplicativo dentro do storage do navegador. Entra no prefixo
// de toda chave para que a limpeza nunca encoste em dados de outro site.
export const DRAFT_NAMESPACE = 'gr';

// Prefixo único dos rascunhos. Nenhuma limpeza toca em chave fora deste prefixo.
export const DRAFT_PREFIX = `${DRAFT_NAMESPACE}:draft`;

// Versão do ENVELOPE gravado. Incrementar quando a forma de `data` mudar de
// modo incompatível: rascunhos com outra versão são descartados, nunca
// interpretados às cegas (ver `readDraft`).
export const DRAFT_VERSION = 1;

// Gravação automática com atraso. Evita um `setItem` por tecla e continua
// dentro da faixa de 300–800ms pedida.
export const DRAFT_DEBOUNCE_MS = 500;

// Rascunho não vive para sempre: 7 dias. Centralizado aqui.
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Limite de profundidade ao sanear o payload. Evita estourar a pilha com
// estruturas aninhadas absurdas vindas de um rascunho antigo.
export const DRAFT_MAX_DEPTH = 8;

// Telefone no fim do nome: o texto fala de rascunho, nunca de "salvo".
export const DRAFT_LABEL_SAVED = 'Rascunho salvo localmente';
export const DRAFT_LABEL_RESTORED = 'Rascunho restaurado';
export const DRAFT_LABEL_DISCARDED = 'Rascunho descartado';
export const DRAFT_LABEL_SAVING = 'Salvando rascunho localmente...';
export const DRAFT_LABEL_STALE = 'Este registro foi alterado depois deste rascunho. Nada foi restaurado — revise os dados do sistema.';
export const DRAFT_LABEL_EXTERNAL = 'Este rascunho também foi alterado em outra aba. Ao salvar, vale a escrita mais recente.';
export const DRAFT_LABEL_UNAVAILABLE = 'Rascunho indisponível neste navegador.';
export const DRAFT_LABEL_FILE = 'Selecione o arquivo novamente.';
export const DRAFT_CANCEL_CONFIRM = 'Deseja descartar o rascunho?';

// Campos que NUNCA entram num rascunho, em qualquer formulário. São
// transientes/visuais ou credenciais: carregá-los não faz sentido e guardá-los
// seria apenas risco. A lista por formulário (`excludeFields`) complementa esta.
export const DRAFT_GLOBAL_EXCLUDED_FIELDS = Object.freeze([
  // transientes de UI e de tela
  'saving', 'loading', 'errors', 'error', 'failure', 'uploading', 'uploads',
  'modalOpen', 'open', 'toast', 'toasts', 'notice', 'row', 'rows',
  // credenciais e segredos (defesa em profundidade; nenhuma tela do sistema
  // possui esses campos, mas a lista é o contrato do núcleo)
  'password', 'senha', 'pass', 'token', 'accessToken', 'access_token',
  'refreshToken', 'refresh_token', 'apiKey', 'api_key', 'secret',
  'clientSecret', 'client_secret', 'authorization', 'auth', 'session',
  // referências de elemento e artefatos de arquivo
  'file', 'files', 'fileRef', 'proofRef', 'invoiceRef', 'ref', 'client',
]);

// Motivos possíveis devolvidos pelo núcleo. São a fonte única de verdade para
// mensagem e para teste; nada de string mágica espalhada nos componentes.
export const DRAFT_REASONS = Object.freeze({
  OK: 'ok',
  MISSING: 'missing',
  NO_USER: 'no-user',
  STORAGE_UNAVAILABLE: 'storage-unavailable',
  READ_FAILED: 'read-failed',
  WRITE_FAILED: 'write-failed',
  INVALID_JSON: 'invalid-json',
  INCOMPATIBLE_VERSION: 'incompatible-version',
  EXPIRED: 'expired',
  USER_MISMATCH: 'user-mismatch',
  MALFORMED: 'malformed',
  QUOTA: 'quota',
});

// Texto de interface para cada motivo de descarte. `null` = "não havia nada
// para avisar" e o componente não renderiza nada.
export const DRAFT_REASON_LABELS = Object.freeze({
  [DRAFT_REASONS.INVALID_JSON]: 'Rascunho anterior estava corrompido e foi descartado.',
  [DRAFT_REASONS.INCOMPATIBLE_VERSION]: 'Rascunho anterior de outra versão foi descartado.',
  [DRAFT_REASONS.EXPIRED]: 'Rascunho anterior estava expirado e foi descartado.',
  [DRAFT_REASONS.MALFORMED]: 'Rascunho anterior estava inconsistente e foi descartado.',
  [DRAFT_REASONS.STORAGE_UNAVAILABLE]: DRAFT_LABEL_UNAVAILABLE,
  [DRAFT_REASONS.QUOTA]: 'Não foi possível guardar o rascunho (armazenamento cheio).',
});

// Registro central das chaves de formulário. Duas telas com a mesma `formKey`
// colidiria: por isso o registro, e por isso a suíte de testes cobre colisão
// entre forms e entre ids diferentes.
export const DRAFT_FORM_KEYS = Object.freeze({
  FINANCEIRO_GASTO_NOVO: 'financeiro:gasto:new',
  FINANCEIRO_GASTO_EDIT: 'financeiro:gasto:edit',
  FINANCEIRO_PAGAMENTO_NOVO: 'financeiro:pagamento:new',
  FINANCEIRO_CONTA_PAGAR_NOVO: 'financeiro:conta-pagar:new',
  RH_COLABORADOR_NOVO: 'rh:colaborador:new',
  ESTOQUE_ITEM_NOVO: 'estoque:item:new',
  PRODUCAO_ORDEM_NOVO: 'producao:ordem:new',
});

// Monta a `formKey` de EDIÇÃO a partir do id do registro. O id entra na chave
// para que dois registros nunca compartilhem rascunho.
export const draftEditKey = (baseKey, id) => (id ? `${baseKey}:${id}` : baseKey);
