export const PLATFORMS = Object.freeze({ instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' });
export const CATEGORIES = Object.freeze(['elogio', 'dúvida', 'preço', 'horário', 'delivery', 'produto', 'reclamação', 'problema com pedido', 'disponibilidade', 'outro']);
export const METRICS = Object.freeze({ followers: 'Seguidores', reach: 'Alcance', impressions: 'Impressões', engagements: 'Engajamentos', comments: 'Comentários recebidos', replied: 'Comentários respondidos', pending: 'Comentários pendentes', response_rate: 'Taxa de resposta' });
export const STATUS = Object.freeze({ pending: 'Não respondido', awaiting_approval: 'Aguardando aprovação', replied: 'Respondido' });

// Mirror of the backend matrix for presentation only. Backend verifies Auth independently.
export function socialPermissions(role) {
  const admin = ['admin', 'super_admin'].includes(role);
  const manager = admin || ['manager', 'gerente'].includes(role);
  return { view: manager, report: manager, reply: admin, approve_ai: admin, configure: admin };
}

export function dayInSaoPaulo(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
const shiftDay = (day, delta) => new Date(Date.parse(`${day}T12:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
const validDay = day => /^\d{4}-\d{2}-\d{2}$/.test(day || '') && !Number.isNaN(Date.parse(`${day}T12:00:00Z`)) && shiftDay(day, 0) === day;
export function periodRange(mode, start, end, now = new Date()) {
  const today = dayInSaoPaulo(now);
  if (mode === 'custom') {
    if (!validDay(start) || !validDay(end) || start > end) return null;
    return { start, end };
  }
  if (!['today', '7', '30'].includes(mode)) return null;
  return { start: shiftDay(today, -(mode === 'today' ? 0 : Number(mode) - 1)), end: today };
}
export function previousPeriod(range) {
  if (!range) return null;
  const days = (Date.parse(range.end) - Date.parse(range.start)) / 86400000 + 1;
  return { start: shiftDay(range.start, -days), end: shiftDay(range.start, -1) };
}
export const inPeriod = (value, range) => {
  if (!range || !value || Number.isNaN(Date.parse(value))) return false;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dayInSaoPaulo(value);
  return day >= range.start && day <= range.end;
};
const searchable = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function filterComments(comments, { provider = 'all', status = 'all', category = 'all', sentiment = 'all', search = '', range }) {
  const query = searchable(search).trim();
  return comments.filter(c => (provider === 'all' || c.provider === provider)
    && (status === 'all' || c.status === status)
    && (category === 'all' || c.category === category)
    && (sentiment === 'all' || c.sentiment === sentiment)
    && inPeriod(c.created_at, range)
    && searchable(`${c.author_name} ${c.text} ${c.post_title || ''} ${c.external_post_id}`).includes(query))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id));
}
export function safePermalink(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
export function commentKey(c) {
  if (!Object.hasOwn(PLATFORMS, c.provider) || !c.account_id || !c.external_comment_id) throw new Error('Identidade de comentário inválida');
  return JSON.stringify([c.provider, String(c.account_id), String(c.external_comment_id)]);
}
export function normalizeComment(input) {
  const id = commentKey(input);
  if (!input.created_at || Number.isNaN(Date.parse(input.created_at))) throw new Error('Data inválida');
  return {
    id, provider: input.provider, account_id: String(input.account_id), external_comment_id: String(input.external_comment_id),
    external_post_id: String(input.external_post_id || ''), author_id: input.author_id ? String(input.author_id) : null,
    author_name: String(input.author_name || 'Perfil não informado').slice(0, 200), text: String(input.text || '').slice(0, 10000),
    post_title: String(input.post_title || '').slice(0, 500), created_at: new Date(input.created_at).toISOString(),
    replied_at: null, status: 'pending', permalink: safePermalink(input.permalink), raw_metadata: {},
  };
}
// Reference reconciliation; production must use the UNIQUE key in a DB transaction.
export function reconcileComment(existing, input) {
  const normalized = normalizeComment(input);
  if (!existing) return normalized;
  if (commentKey(existing) !== commentKey(normalized)) throw new Error('Identidades incompatíveis');
  return { ...existing, author_name: normalized.author_name, text: normalized.text, permalink: normalized.permalink, post_title: normalized.post_title };
}

// Never aggregate provider metrics or sum snapshots/unique reach across dates/accounts.
export function metricSeries(metrics, provider, metric, range) {
  if (provider === 'all') return [];
  const latest = new Map();
  metrics.filter(m => m.provider === provider && m.metric === metric && inPeriod(m.period, range) && typeof m.value === 'number' && Number.isFinite(m.value)).forEach(m => {
    const key = JSON.stringify([m.account_id, m.definition, m.unit, m.period_type, m.period]);
    const previous = latest.get(key);
    if (!previous || Date.parse(m.collected_at || 0) >= Date.parse(previous.collected_at || 0)) latest.set(key, m);
  });
  return [...latest.values()].sort((a, b) => a.period.localeCompare(b.period));
}
export function normalizeMetric(input) {
  if (!Object.hasOwn(PLATFORMS, input.provider) || !Object.hasOwn(METRICS, input.metric)
    || !input.account_id || !input.definition || !input.unit || !input.period_type || !validDay(input.period)
    || typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < 0
    || !input.collected_at || Number.isNaN(Date.parse(input.collected_at))) throw new Error('Métrica inválida');
  return Object.fromEntries(['provider', 'account_id', 'metric', 'definition', 'unit', 'period_type', 'period', 'value', 'collected_at'].map(key => [key, input[key]]));
}
export function commentSummary(comments, provider, range, connected = false) {
  if (!connected) return { comments: null, replied: null, pending: null, response_rate: null };
  const rows = filterComments(comments, { provider, range });
  const replied = rows.filter(c => c.status === 'replied').length;
  return { comments: rows.length, replied, pending: rows.length - replied, response_rate: rows.length ? 100 * replied / rows.length : null };
}
