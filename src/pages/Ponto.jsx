import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { todayISO } from '@/lib/timeUtils';
import { usePontoData, buildDayRows, summarizeRows } from '@/lib/pontoData';
import { markAbsence } from '@/lib/pontoActions';
import { currentUserName } from '@/lib/useCurrentUser';
import { Calendar, Filter } from 'lucide-react';
import PontoDashboard from '@/components/ponto/PontoDashboard';
import PontoDia from '@/components/ponto/PontoDia';
import RegistroRapido from '@/components/ponto/RegistroRapido';
import PontosIncompletos from '@/components/ponto/PontosIncompletos';
import AjusteManual from '@/components/ponto/AjusteManual';

const TABS = [
  { key: 'dia', label: 'Ponto do dia' },
  { key: 'rapido', label: 'Registro rápido' },
  { key: 'incompletos', label: 'Incompletos' },
];

export default function Ponto() {
  const [date, setDate] = useState(todayISO());
  const [tab, setTab] = useState('dia');
  const [fSector, setFSector] = useState('');
  const [fUnit, setFUnit] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [tolerance, setTolerance] = useState(5);
  const [adjustRow, setAdjustRow] = useState(null);

  const { schedules, records, loading, reload } = usePontoData(date);

  useEffect(() => {
    base44.entities.SystemSettings.list('-created_date', 1).then((s) => {
      if (s[0]?.tolerance_minutes != null) setTolerance(s[0].tolerance_minutes);
    });
  }, []);

  const rows = useMemo(() => buildDayRows(schedules, records, tolerance), [schedules, records, tolerance]);
  const counts = useMemo(() => summarizeRows(rows), [rows]);
  const escalados = rows.filter((r) => r.schedule).length;

  const sectors = useMemo(() => [...new Set(rows.map((r) => r.sector).filter(Boolean))], [rows]);
  const units = useMemo(() => [...new Set(rows.map((r) => r.unit).filter(Boolean))], [rows]);

  const filtered = rows.filter((r) =>
    (!fSector || r.sector === fSector) &&
    (!fUnit || r.unit === fUnit) &&
    (!fStatus || r.status === fStatus)
  );

  const handleMarkAbsence = async (row, type) => {
    await markAbsence(row, type, { responsible: currentUserName() });
    reload();
  };

  const handleAdjust = (row) => setAdjustRow(row);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Central de Ponto</h1>
          <p className="text-sm text-slate-500">Controle de jornada, presença e ocorrências</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
          />
        </div>
      </div>

      <PontoDashboard counts={counts} escalados={escalados} />

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-xl p-3">
        <div className="flex items-center gap-1.5 text-slate-500 text-sm mr-2"><Filter className="w-4 h-4" /> Filtros</div>
        <select value={fSector} onChange={(e) => setFSector(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm">
          <option value="">Todos os setores</option>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fUnit} onChange={(e) => setFUnit(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm">
          <option value="">Todas as unidades</option>
          {units.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm">
          <option value="">Todos os status</option>
          <option value="presente">Presente</option>
          <option value="atrasado">Atrasado</option>
          <option value="ausente">Ausente</option>
          <option value="folga">Folga</option>
          <option value="intervalo">Intervalo</option>
          <option value="finalizado">Finalizado</option>
          <option value="incompleto">Incompleto</option>
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-amber-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-10 text-center text-slate-400 text-sm">Carregando...</div>
      ) : tab === 'dia' ? (
        <PontoDia rows={filtered} onMarkAbsence={handleMarkAbsence} onAdjust={handleAdjust} />
      ) : tab === 'rapido' ? (
        <RegistroRapido date={date} tolerance={tolerance} />
      ) : (
        <PontosIncompletos rows={filtered} onAdjust={handleAdjust} />
      )}

      <AjusteManual open={!!adjustRow} onOpenChange={(o) => !o && setAdjustRow(null)} row={adjustRow} tolerance={tolerance} onDone={reload} />
    </div>
  );
}