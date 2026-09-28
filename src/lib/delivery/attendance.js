// Lógica pura da Central de Atendimento: sem rede, sem banco e sem provar permissão —
// o navegador apenas reflete o canManage decidido pelo servidor.
export const MODE_LABELS = Object.freeze({ human: 'Humano', ai: 'IA' });
export const OWNER_FILTERS = Object.freeze({ all: 'Todos os responsáveis', mine: 'Você', others: 'Outros operadores', none: 'Sem responsável' });

// Ordenação pedida: última mensagem primeiro; sem mensagem, a última atualização da conversa.
export function activityAt(row) {
  const value = row?.last_message?.received_at ?? row?.last_message?.occurred_at ?? row?.updated_at ?? '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}
export function sortConversations(rows) {
  return [...rows].sort((a, b) => activityAt(b) - activityAt(a) || String(a.id).localeCompare(String(b.id)));
}

export function conversationView(row, actorId) {
  const customer = row.customer || {};
  const assignedTo = row.assigned_to || null;
  return {
    id: row.id, provider: row.provider, merchantId: row.merchant_id, externalId: row.external_id,
    mode: row.mode, modeLabel: MODE_LABELS[row.mode] || row.mode, version: row.version,
    assignedTo, ownerShort: assignedTo ? assignedTo.slice(0, 8) : null,
    ownerLabel: !assignedTo ? 'Sem responsável' : (actorId && assignedTo === actorId ? 'Você' : 'Outro operador'),
    name: customer.name || null, phone: customer.phone || null, customerExternalId: customer.external_id || null,
    lastBody: row.last_message?.body || null, lastDirection: row.last_message?.direction || null,
    lastAt: activityAt(row) ? new Date(activityAt(row)).toISOString() : null,
    unread: Number.isInteger(row.unread_count) && row.unread_count > 0 ? row.unread_count : 0,
    updatedAt: row.updated_at,
  };
}

// Filtros operacionais sobre a lista já carregada. Não existe estado "aberta/
// finalizada" no modelo, então esse filtro não é criado nem simulado.
export function filterConversations(rows, { channel = 'all', merchant = 'all', mode = 'all', owner = 'all',
  actorId = null, unreadOnly = false, search = '' } = {}) {
  const query = search.trim().toLocaleLowerCase('pt-BR');
  return rows.filter(row => {
    if (channel !== 'all' && row.provider !== channel) return false;
    if (merchant !== 'all' && row.merchant_id !== merchant) return false;
    if (mode !== 'all' && row.mode !== mode) return false;
    if (owner !== 'all') {
      const mine = Boolean(actorId && row.assigned_to === actorId);
      if (owner === 'mine' && !mine) return false;
      if (owner === 'others' && !(row.assigned_to && !mine)) return false;
      if (owner === 'none' && row.assigned_to) return false;
    }
    if (unreadOnly && !(Number.isInteger(row.unread_count) && row.unread_count > 0)) return false;
    if (!query) return true;
    const haystack = [row.customer?.name, row.customer?.phone, row.customer?.external_id,
      row.external_id, row.last_message?.body];
    return haystack.some(value => value && String(value).toLocaleLowerCase('pt-BR').includes(query));
  });
}

export const unreadBadge = count => (count > 99 ? '99+' : String(count));

// O servidor devolve mensagens em ordem decrescente (paginação); o painel exibe em
// ordem cronológica, com desempate estável por horário de recebimento e identificador.
export function orderMessages(rows) {
  return [...rows].sort((a, b) => Date.parse(a.occurred_at || '') - Date.parse(b.occurred_at || '')
    || Date.parse(a.received_at || '') - Date.parse(b.received_at || '')
    || String(a.id).localeCompare(String(b.id)));
}

// Rótulo honesto do estado de cada mensagem; rascunho nunca aparece como enviado.
export function messageLabel(row) {
  if (row.invalidated || row.status === 'invalidated') return 'Rascunho invalidado';
  if (row.direction === 'inbound') return row.author === 'system' ? 'Mensagem do sistema' : 'Mensagem recebida';
  if (row.status === 'draft') return row.author === 'ai' ? 'Rascunho da IA (não enviado)' : 'Rascunho humano (não enviado)';
  return row.author === 'ai' ? 'Registro da IA' : 'Registro humano';
}

// Estado do painel: atualização preserva dados e seleção e não desmonta a lista;
// falha mantém as linhas já carregadas e apenas registra o erro.
/**
 * @typedef {{ rows: Array<Record<string, any>> | null, selectedId: string | null, error: string, loading: boolean }} AttendanceState
 */
export const initialAttendance = Object.freeze({ rows: null, selectedId: null, error: '', loading: false });
/**
 * @param {AttendanceState} state
 * @param {{ type: string, rows?: Array<Record<string, any>>, error?: string, id?: string, changes?: Record<string, any> }} action
 * @returns {AttendanceState}
 */
export function attendanceReducer(state, action) {
  switch (action.type) {
    case 'loading': return { ...state, loading: true, error: '' };
    case 'loaded': return { ...state, rows: action.rows, loading: false, error: '' };
    case 'failed': return { ...state, loading: false, error: action.error };
    case 'select': return { ...state, selectedId: action.id };
    case 'patch': return { ...state, rows: (state.rows || []).map(row => row.id === action.id ? { ...row, ...action.changes } : row) };
    default: return state;
  }
}

export function handoffAvailability(row, canManage) {
  if (!row) return { allowed: false, reason: 'SEM_CONVERSA_SELECIONADA' };
  if (!canManage) return { allowed: false, reason: 'SEM_PERMISSAO_NA_LOJA' };
  return { allowed: true, reason: null };
}

// Envio de mensagem não existe nesta fase; o motivo é explícito e a nota de IA
// só afirma configuração quando o servidor informa aiConfigured verdadeiro.
/**
 * @param {{ mode?: string, aiConfigured?: boolean }} [options]
 */
export function replyState({ mode, aiConfigured } = {}) {
  return {
    sendEnabled: false,
    sendReason: 'SEND_NOT_ENABLED',
    note: mode === 'human'
      ? 'Atendimento humano: nenhuma resposta automática é gerada.'
      : (aiConfigured ? 'Modo IA: apenas rascunho é gravado; nenhuma mensagem é enviada.'
        : 'IA não configurada: nenhum rascunho automático é gerado até a configuração do provedor.'),
  };
}

// Rascunho local por conversa (localStorage quando disponível). É apenas texto do
// operador: nenhuma função aqui chama rede ou persiste no banco.
export const draftKey = (provider, merchantId, conversationId) => `central-delivery:draft:${provider}:${merchantId}:${conversationId}`;
export function readDraft(storage, key) {
  try { const value = storage?.getItem(key); return typeof value === 'string' ? value : ''; } catch { return ''; }
}
export function saveDraft(storage, key, text) {
  try { storage?.setItem(key, text); } catch { /* armazenamento indisponível: rascunho segue em memória */ }
}
export function clearDraft(storage, key) {
  try { storage?.removeItem(key); } catch { /* armazenamento indisponível */ }
}

export function customerView(row) {
  return {
    id: row.id, provider: row.provider, merchantId: row.merchant_id, externalId: row.external_id,
    name: row.name || null, phone: row.phone || null, createdAt: row.created_at || null,
    conversationCount: Number.isInteger(row.conversation_count) ? row.conversation_count : 0,
    lastInteractionAt: row.last_interaction_at || null,
  };
}
export function filterCustomers(rows, { channel = 'all', merchant = 'all', search = '' } = {}) {
  const query = search.trim().toLocaleLowerCase('pt-BR');
  return rows.filter(row => (channel === 'all' || row.provider === channel)
    && (merchant === 'all' || row.merchant_id === merchant)
    && (!query || [row.name, row.phone, row.external_id].some(value => value && String(value).toLocaleLowerCase('pt-BR').includes(query))));
}

