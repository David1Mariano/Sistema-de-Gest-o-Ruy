import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { registerPunch, PUNCH_LABELS } from '@/lib/pontoActions';
import { currentUserName } from '@/lib/useCurrentUser';
import { LogIn, UtensilsCrossed, LogOut, DoorOpen, CheckCircle2 } from 'lucide-react';

const PUNCHES = [
  { key: 'entrada', label: 'ENTRADA', icon: LogIn, color: 'bg-emerald-500' },
  { key: 'almoco', label: 'ALMOÇO', icon: UtensilsCrossed, color: 'bg-amber-500' },
  { key: 'retorno', label: 'RETORNO', icon: DoorOpen, color: 'bg-sky-500' },
  { key: 'saida', label: 'SAÍDA', icon: LogOut, color: 'bg-rose-500' },
];

export default function RegistroRapido({ date, tolerance = 5 }) {
  const [employees, setEmployees] = useState([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    base44.entities.Employee.filter({ status: 'ativo' }, 'name', 500).then(setEmployees);
  }, []);

  const punch = async (type) => {
    if (!selected) return;
    setBusy(type);
    try {
      const emp = employees.find((e) => e.id === selected);
      const { time } = await registerPunch(emp, date, type, { tolerance, responsible: currentUserName() });
      setConfirm({ type, time });
      setTimeout(() => setConfirm(null), 4000);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-md mx-auto space-y-5">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Registro rápido</h2>
        <p className="text-sm text-slate-500">Toque para registrar a jornada do colaborador</p>
      </div>

      <select
        className="w-full h-12 rounded-xl border border-slate-300 bg-white px-4 text-base font-medium"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">Selecione o funcionário</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>{e.name} — {e.sector || 'Sem setor'}</option>
        ))}
      </select>

      <div className="grid grid-cols-2 gap-3">
        {PUNCHES.map((p) => {
          const Icon = p.icon;
          return (
            <button
              key={p.key}
              disabled={!selected || busy === p.key}
              onClick={() => punch(p.key)}
              className={`${p.color} disabled:opacity-40 text-white rounded-2xl py-8 flex flex-col items-center gap-2 transition active:scale-95 shadow-sm`}
            >
              {busy === p.key ? (
                <div className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <Icon className="w-7 h-7" />
              )}
              <span className="text-base font-semibold tracking-wide">{p.label}</span>
            </button>
          );
        })}
      </div>

      {confirm && (
        <div className="flex items-center gap-2 justify-center text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-xl py-3 animate-in fade-in">
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-medium">{PUNCH_LABELS[confirm.type]} registrada às {confirm.time}</span>
        </div>
      )}
    </div>
  );
}