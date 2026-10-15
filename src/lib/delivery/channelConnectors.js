// Conectores de canal: WhatsApp / iFood / 99Food / futuros.
// SEM scraping, SEM presumir API de vendas. Sem credencial => modo DEMO +
// importacao manual CSV/XLSX com conferencia e anti-duplicidade (external_id).
export const CONNECTORS = {
  whatsapp: { label: 'WhatsApp', mode: 'demo', note: 'Sem API oficial conectada. Use importação CSV ou registro manual.' },
  ifood: { label: 'iFood', mode: 'demo', note: 'Sem credencial iFood (API oficial exige OAuth + loja). Modo demonstração.' },
  food99: { label: '99Food', mode: 'demo', note: 'Sem credencial 99Food. Modo demonstração.' },
};

// CSV esperado: external_id;data;cliente;telefone;canal;item;qtd;preco;taxa_entrega;desconto;pagamento
// preco em reais pt-BR (ex.: 25,50). Idempotente por external_id.
export function parseChannelCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { rows: [], errors: ['CSV vazio ou sem cabeçalho.'] };
  const head = lines[0].split(';').map((h) => h.trim().toLowerCase());
  const need = ['external_id', 'data', 'cliente', 'item', 'qtd', 'preco'];
  const missing = need.filter((c) => !head.includes(c));
  if (missing.length) return { rows: [], errors: [`Colunas ausentes: ${missing.join(', ')}`] };
  const rows = [], errors = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(';');
    const r = Object.fromEntries(head.map((h, k) => [h, (cells[k] || '').trim()]));
    if (!r.external_id || !r.cliente || !r.item) { errors.push(`Linha ${i + 1}: external_id/cliente/item obrigatórios.`); continue; }
    const qty = Number(String(r.qtd || '1').replace(',', '.'));
    const price = Number(String(r.preco || '0').replace(/\./g, '').replace(',', '.')) || 0;
    if (!(qty > 0) || !(price >= 0)) { errors.push(`Linha ${i + 1}: qtd/preço inválidos.`); continue; }
    rows.push({ ...r, qty, unit_price_cents: Math.round(price * 100) });
  }
  return { rows, errors };
}

export function dedupImport(rows, existingExternalIds) {
  const seen = new Set(existingExternalIds || []);
  const fresh = [], skipped = [];
  for (const r of rows) {
    if (seen.has(r.external_id)) skipped.push(r.external_id);
    else { seen.add(r.external_id); fresh.push(r); }
  }
  return { fresh, skipped };
}
