// Utilitários compartilhados do módulo RH — RUY GESTÃO
import { todayISO, addDays, startOfWeek, endOfWeek } from './timeUtils';

export const EMPLOYEE_STATUS = {
  ativo: { label: 'Ativo', style: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  em_experiencia: { label: 'Em experiência', style: 'bg-sky-100 text-sky-700 border-sky-200' },
  folga: { label: 'Folga', style: 'bg-slate-100 text-slate-600 border-slate-200' },
  ferias: { label: 'Férias', style: 'bg-violet-100 text-violet-700 border-violet-200' },
  afastado: { label: 'Afastado', style: 'bg-amber-100 text-amber-700 border-amber-200' },
  desligado: { label: 'Desligado', style: 'bg-rose-100 text-rose-700 border-rose-200' },
  inativo: { label: 'Inativo', style: 'bg-slate-100 text-slate-400 border-slate-200' },
};

export const HIRE_TYPE_LABELS = {
  clt: 'CLT', pj: 'PJ', diarista: 'Diarista', estagio: 'Estágio', autonomo: 'Autônomo', outros: 'Outros',
};

export const ABSENCE_TYPES = {
  falta: { label: 'Falta', style: 'bg-rose-100 text-rose-700 border-rose-200' },
  atraso: { label: 'Atraso', style: 'bg-amber-100 text-amber-700 border-amber-200' },
  saida_antecipada: { label: 'Saída antecipada', style: 'bg-orange-100 text-orange-700 border-orange-200' },
  ausencia_parcial: { label: 'Ausência parcial', style: 'bg-amber-100 text-amber-700 border-amber-200' },
  justificada: { label: 'Justificada', style: 'bg-sky-100 text-sky-700 border-sky-200' },
  nao_justificada: { label: 'Não justificada', style: 'bg-rose-100 text-rose-700 border-rose-200' },
  folga: { label: 'Folga', style: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export const VALE_STATUS = {
  pendente: { label: 'Pendente', style: 'bg-amber-100 text-amber-700 border-amber-200' },
  descontado: { label: 'Descontado', style: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  cancelado: { label: 'Cancelado', style: 'bg-slate-100 text-slate-500 border-slate-200' },
};

export const CONSUMPTION_STATUS = {
  registrado: { label: 'Registrado', style: 'bg-sky-100 text-sky-700 border-sky-200' },
  cobrado: { label: 'Cobrado', style: 'bg-amber-100 text-amber-700 border-amber-200' },
  liberado: { label: 'Liberado', style: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  cancelado: { label: 'Cancelado', style: 'bg-slate-100 text-slate-500 border-slate-200' },
};

export const WARNING_CATEGORIES = {
  atraso_recorrente: 'Atraso recorrente',
  falta: 'Falta',
  descumprimento: 'Descumprimento de procedimento',
  comportamento: 'Comportamento',
  falha_operacional: 'Falha operacional',
  outros: 'Outros',
};

export const WARNING_STATUS = {
  pendente: { label: 'Pendente', style: 'bg-amber-100 text-amber-700 border-amber-200' },
  tratada: { label: 'Tratada', style: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  cancelada: { label: 'Cancelada', style: 'bg-slate-100 text-slate-500 border-slate-200' },
};

export const DOC_CATEGORIES = {
  documento_pessoal: 'Documento pessoal',
  comprovante: 'Comprovante',
  termo: 'Termo',
  advertencia: 'Advertência',
  atestado: 'Atestado',
  recibo: 'Recibo',
  outros: 'Outros',
};

// Período de filtro -> { start, end } em ISO
export function rangeFor(period, custom = null) {
  const today = todayISO();
  if (period === 'hoje') return { start: today, end: today };
  if (period === 'semana') return { start: startOfWeek(today), end: endOfWeek(today) };
  if (period === 'mes') {
    const [y, m] = today.split('-');
    const end = addDays(`${y}-${m}-28`, 4 > 0 ? 0 : 0);
    const last = new Date(Number(y), Number(m), 0).getDate();
    return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(last).padStart(2, '0')}` };
  }
  if (period === 'personalizado' && custom) return custom;
  return { start: '', end: '' };
}

export function inRange(iso, { start, end }) {
  if (!iso) return false;
  if (start && iso < start) return false;
  if (end && iso > end) return false;
  return true;
}

// Tempo de empresa em texto
export function tenure(admissionISO) {
  if (!admissionISO) return '—';
  const start = new Date(admissionISO + 'T00:00:00');
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years > 0 && rem > 0) return `${years}a ${rem}m`;
  if (years > 0) return `${years} ano(s)`;
  return `${rem} ${rem === 1 ? 'mês' : 'meses'}`;
}

// Formata valor em R$
export function brl(v) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}