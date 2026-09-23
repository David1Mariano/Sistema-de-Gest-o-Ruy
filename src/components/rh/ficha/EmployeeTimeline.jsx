import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { formatBR } from '@/lib/timeUtils';
import { ABSENCE_TYPES, VALE_STATUS, WARNING_CATEGORIES, DOC_CATEGORIES, brl } from '@/lib/rhUtils';

// Linha do tempo automática do colaborador — agrega auditoria + eventos de RH
export default function EmployeeTimeline({ employeeId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [audit, abs, vales, warns, evals, docs] = await Promise.all([
          base44.entities.AuditLog.filter({ entity_id: employeeId }, '-created_date', 200),
          base44.entities.Absence.filter({ employee_id: employeeId }, '-created_date', 200),
          base44.entities.Vale.filter({ employee_id: employeeId }, '-created_date', 200),
          base44.entities.Warning.filter({ employee_id: employeeId }, '-created_date', 200),
          base44.entities.Evaluation.filter({ employee_id: employeeId }, '-created_date', 200),
          base44.entities.EmployeeDocument.filter({ employee_id: employeeId }, '-created_date', 200),
        ]);
        const evs = [];
        audit.forEach((a) => evs.push({
          date: (a.created_date || '').slice(0, 10), time: (a.created_date || '').slice(11, 16),
          type: labelAudit(a), desc: descAudit(a), responsible: a.responsible_user, old: a.old_value, new: a.new_value,
        }));
        abs.forEach((a) => evs.push({ date: a.date, time: (a.created_date || '').slice(11, 16), type: ABSENCE_TYPES[a.type]?.label || a.type, desc: `Ocorrência de frequência${a.reason ? ' — ' + a.reason : ''}`, responsible: a.responsible_user }));
        vales.forEach((v) => evs.push({ date: v.date, time: (v.created_date || '').slice(11, 16), type: `Vale ${VALE_STATUS[v.status]?.label || ''}`, desc: `${brl(v.amount)} — ${v.motive || v.type || ''}`, responsible: v.authorized_by }));
        warns.forEach((w) => evs.push({ date: w.date, time: (w.created_date || '').slice(11, 16), type: `Advertência: ${WARNING_CATEGORIES[w.category] || ''}`, desc: w.description || '', responsible: w.responsible_user }));
        evals.forEach((e) => evs.push({ date: e.date, time: (e.created_date || '').slice(11, 16), type: 'Avaliação', desc: `${e.period || ''} — nota ${e.score ?? '—'}`, responsible: e.evaluator }));
        docs.forEach((d) => evs.push({ date: d.date, time: (d.created_date || '').slice(11, 16), type: `Documento: ${DOC_CATEGORIES[d.category] || ''}`, desc: d.name, responsible: d.uploaded_by }));
        evs.sort((a, b) => ((b.date || '') + (b.time || '')).localeCompare((a.date || '') + (a.time || '')));
        setEvents(evs);
      } finally { setLoading(false); }
    })();
  }, [employeeId]);

  if (loading) return <div className="p-6 text-center text-slate-400 text-sm">Montando linha do tempo...</div>;
  if (events.length === 0) return <div className="p-6 text-center text-slate-400 text-sm">Nenhum evento registrado ainda.</div>;

  return (
    <div className="relative pl-6">
      <div className="absolute left-2 top-1 bottom-1 w-px bg-slate-200" />
      <div className="space-y-4">
        {events.map((e, i) => (
          <div key={i} className="relative">
            <div className="absolute -left-[18px] top-1 w-3 h-3 rounded-full bg-amber-400 border-2 border-white shadow" />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-xs font-medium text-slate-400 tabular-nums">{formatBR(e.date)} {e.time && `· ${e.time}`}</span>
              <span className="text-sm font-medium text-slate-800">{e.type}</span>
            </div>
            {e.desc && <p className="text-sm text-slate-600 mt-0.5">{e.desc}</p>}
            {(e.old || e.new) && <p className="text-xs text-slate-400 mt-0.5">{e.old || '∅'} → {e.new || '∅'}</p>}
            {e.responsible && <p className="text-xs text-slate-400 mt-0.5">Responsável: {e.responsible}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function labelAudit(a) {
  const map = { criacao: 'Cadastro criado', alteracao: 'Alteração de cadastro', exclusao_logica: 'Desligamento', registro_falta: 'Falta registrada', substituicao: 'Substituição', criacao_escala: 'Escala criada', alteracao_escala: 'Escala alterada' };
  return a.field ? `Alteração: ${a.field}` : (map[a.action] || a.action);
}
function descAudit(a) {
  if (a.reason) return a.reason;
  if (a.field) return `${a.old_value || '∅'} → ${a.new_value || '∅'}`;
  return a.new_value || '';
}