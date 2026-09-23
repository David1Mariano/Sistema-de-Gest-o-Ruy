import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, Pencil, User, Calendar, Trash2 } from 'lucide-react';
import EmployeeForm from '@/components/rh/EmployeeForm';
import EmployeeTimeline from '@/components/rh/ficha/EmployeeTimeline';
import AbsenceForm from '@/components/rh/AbsenceForm';
import ValeForm from '@/components/rh/ValeForm';
import ConsumptionForm from '@/components/rh/ConsumptionForm';
import WarningForm from '@/components/rh/WarningForm';
import DocumentForm from '@/components/rh/DocumentForm';
import EvaluationForm from '@/components/rh/EvaluationForm';
import PaymentForm from '@/components/rh/PaymentForm';
import { SangriaDialog } from '@/components/financeiro/SangriaPanel';
import { useUserRole } from '@/lib/useUserRole';
import { currentUserName } from '@/lib/useCurrentUser';
import { logAudit } from '@/lib/pontoUtils';
import { formatBR, todayISO } from '@/lib/timeUtils';
import { EMPLOYEE_STATUS, HIRE_TYPE_LABELS, ABSENCE_TYPES, VALE_STATUS, CONSUMPTION_STATUS, WARNING_CATEGORIES, WARNING_STATUS, DOC_CATEGORIES, tenure, brl } from '@/lib/rhUtils';

const SANGRIA_ALLOWED = ['fabielle', 'patrick', 'luiz carlos neto', 'jocinei', 'gracielle', 'adriano', 'kamila'];
const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const canSangria = (name) => SANGRIA_ALLOWED.some(k => norm(name).startsWith(k));

const PAYMENT_TYPE_LABELS = { salario:'Salário', diaria_motoboy:'Diária de motoboy', diaria_freelancer:'Diária de freelancer', vale:'Vale', adiantamento:'Adiantamento', hora_extra:'Hora extra', comissao:'Comissão', ferias:'Férias', decimo_terceiro:'13º salário', acerto:'Acerto', outros:'Outros' };
const PAYMENT_STATUS_LABELS = { pendente:'Pendente', pago:'Pago', cancelado:'Cancelado' };

export default function FichaColaborador() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canViewSensitive, canRegisterOccurrences } = useUserRole();
  const [employee, setEmployee] = useState(null);
  const [absences, setAbsences] = useState([]);
  const [vales, setVales] = useState([]);
  const [consumptions, setConsumptions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [timeRecords, setTimeRecords] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [roles, setRoles] = useState([]);
  const [sangrias, setSangrias] = useState([]);
  const [sangriaOpen, setSangriaOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState('visao');
  const [formState, setFormState] = useState({ type: null, editing: null });

  const load = async () => {
    setLoading(true);
    try {
      const [emp, abs, val, cons, pay, war, evals, docs, sch, tr, secs, rls, sgr] = await Promise.all([
        base44.entities.Employee.get(id),
        base44.entities.Absence.filter({ employee_id: id }, '-date', 200),
        base44.entities.Vale.filter({ employee_id: id }, '-date', 200),
        base44.entities.Consumption.filter({ employee_id: id }, '-date', 200),
        base44.entities.EmployeePayment.filter({ employee_id: id }, '-payment_date', 500),
        base44.entities.Warning.filter({ employee_id: id }, '-date', 200),
        base44.entities.Evaluation.filter({ employee_id: id }, '-date', 200),
        base44.entities.EmployeeDocument.filter({ employee_id: id }, '-date', 200),
        base44.entities.Schedule.filter({ employee_id: id }, '-date', 100),
        base44.entities.TimeRecord.filter({ employee_id: id }, '-date', 100),
        base44.entities.Sector.list('-created_date', 200),
        base44.entities.JobRole.list('-created_date', 200),
        base44.entities.Sangria.list('-date', 500),
      ]);
      setEmployee(emp); setAbsences(abs); setVales(val); setConsumptions(cons); setPayments(pay); setWarnings(war);
      setEvaluations(evals); setDocuments(docs); setSchedules(sch); setTimeRecords(tr);
      setSectors(secs); setRoles(rls); setSangrias(sgr);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [id]);

  const today = todayISO();
  const [y, m] = today.split('-');
  const monthPrefix = `${y}-${m}`;

  const summary = useMemo(() => {
    const faltasMes = absences.filter((a) => a.date?.startsWith(monthPrefix) && ['falta', 'nao_justificada'].includes(a.type) && a.status === 'ativo').length;
    const atrasosMes = absences.filter((a) => a.date?.startsWith(monthPrefix) && a.type === 'atraso' && a.status === 'ativo').length;
    const valesAberto = vales.filter((v) => v.status === 'pendente').reduce((s, v) => s + (v.amount || 0), 0);
    const advertencias = warnings.filter((w) => w.status !== 'cancelada').length;
    const ultimaAval = evaluations[0];
    const diasTrab = timeRecords.filter((t) => t.date?.startsWith(monthPrefix) && t.entry_time).length;
    return { faltasMes, atrasosMes, valesAberto, advertencias, ultimaAval, diasTrab };
  }, [absences, vales, warnings, evaluations, timeRecords, monthPrefix]);

  const employeeSangrias = useMemo(() => {
    if (!employee) return [];
    return sangrias
      .filter((s) => s.status !== 'cancelado' || true)
      .filter((s) => norm(s.responsible) === norm(employee.name))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [sangrias, employee]);

  if (loading) return <div className="p-10 text-center text-slate-400 text-sm">Carregando ficha...</div>;
  if (!employee) return <div className="p-10 text-center text-slate-400 text-sm">Colaborador não encontrado.</div>;

  const st = EMPLOYEE_STATUS[employee.status] || EMPLOYEE_STATUS.inativo;
  const openForm = (type, editing = null) => setFormState({ type, editing });
  const closeForm = () => setFormState({ type: null, editing: null });

  const deletePayment = async (pay) => {
    if (!window.confirm('Excluir este lançamento de pagamento? Esta ação não pode ser desfeita.')) return;
    await base44.entities.EmployeePayment.delete(pay.id);
    await logAudit({ entity_type: 'EmployeePayment', entity_id: pay.id, action: 'exclusao_logica', old_value: `${pay.payment_type} ${pay.net_amount}`, responsible_user: currentUserName() });
    load();
  };

  const deleteAbsence = async (abs) => {
    if (!window.confirm('Excluir esta ocorrência de frequência? Esta ação não pode ser desfeita.')) return;
    await base44.entities.Absence.delete(abs.id);
    await logAudit({ entity_type: 'Absence', entity_id: abs.id, action: 'exclusao_logica', old_value: `${abs.type} ${abs.date}`, responsible_user: currentUserName() });
    load();
  };

  const deleteVale = async (vale) => {
    if (!window.confirm('Excluir este vale? Esta ação não pode ser desfeita.')) return;
    await base44.entities.Vale.delete(vale.id);
    await logAudit({ entity_type: 'Vale', entity_id: vale.id, action: 'exclusao_logica', old_value: `${vale.amount} ${vale.date}`, responsible_user: currentUserName() });
    load();
  };

  const deleteConsumption = async (cons) => {
    if (!window.confirm('Excluir este consumo? Esta ação não pode ser desfeita.')) return;
    await base44.entities.Consumption.delete(cons.id);
    await logAudit({ entity_type: 'Consumption', entity_id: cons.id, action: 'exclusao_logica', old_value: `${cons.product} ${cons.amount} ${cons.date}`, responsible_user: currentUserName() });
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => navigate('/funcionarios')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-2">
          <Pencil className="w-4 h-4" /> Editar
        </Button>
      </div>

      {/* Cabeçalho da ficha */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="w-20 h-20 rounded-2xl bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
            {employee.photo_url
              ? <img src={employee.photo_url} alt="" className="w-full h-full object-cover" />
              : <User className="w-8 h-8 text-slate-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-slate-900">{employee.name}</h1>
            {employee.social_name && <p className="text-sm text-slate-400">"{employee.social_name}"</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-slate-600">
              <span>{employee.function || '—'} · {employee.sector || '—'}</span>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${st.style}`}>{st.label}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
              <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Entrada: {formatBR(employee.admission_date) || '—'} · {tenure(employee.admission_date)}</span>
              <span>Horário: {employee.default_start_time ? `${employee.default_start_time}–${employee.default_end_time || ''}` : '—'}</span>
              <span>Unidade: {employee.unit || '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Cards resumidos */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Faltas no mês', value: summary.faltasMes, tone: 'text-rose-600' },
          { label: 'Atrasos no mês', value: summary.atrasosMes, tone: 'text-amber-600' },
          { label: 'Vales em aberto', value: brl(summary.valesAberto), tone: 'text-amber-600' },
          { label: 'Advertências', value: summary.advertencias, tone: 'text-rose-600' },
          { label: 'Última avaliação', value: summary.ultimaAval?.score ?? '—', tone: 'text-sky-600' },
          { label: 'Dias trabalhados', value: summary.diasTrab, tone: 'text-emerald-600' },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className={`text-lg font-semibold mt-1 ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Abas */}
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <div className="overflow-x-auto">
          <TabsList className="flex w-max">
            <TabsTrigger value="visao">Visão Geral</TabsTrigger>
            <TabsTrigger value="ponto">Ponto</TabsTrigger>
            <TabsTrigger value="escala">Escala</TabsTrigger>
            <TabsTrigger value="faltas">Faltas e Atrasos</TabsTrigger>
            <TabsTrigger value="vales">Vales</TabsTrigger>
            <TabsTrigger value="consumo">Consumo</TabsTrigger>
            <TabsTrigger value="pagamentos">Pagamentos</TabsTrigger>
            <TabsTrigger value="advertencias">Advertências</TabsTrigger>
            <TabsTrigger value="avaliacoes">Avaliações</TabsTrigger>
            <TabsTrigger value="documentos">Documentos</TabsTrigger>
            {canSangria(employee.name) && <TabsTrigger value="sangrias">Sangrias</TabsTrigger>}
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="visao" className="mt-4">
          <VisaoGeral employee={employee} canViewSensitive={canViewSensitive} />
        </TabsContent>

        <TabsContent value="ponto" className="mt-4">
          <SimpleTable
            title="Registros de ponto"
            rows={timeRecords}
            columns={[
              { key: 'date', label: 'Data', render: (r) => formatBR(r.date) },
              { key: 'entry_time', label: 'Entrada' },
              { key: 'lunch_start', label: 'Almoço', render: (r) => `${r.lunch_start || ''}–${r.lunch_end || ''}` },
              { key: 'exit_time', label: 'Saída' },
              { key: 'worked_minutes', label: 'Trabalhado', render: (r) => r.worked_minutes ? `${Math.floor(r.worked_minutes / 60)}h${r.worked_minutes % 60}m` : '—' },
              { key: 'status', label: 'Status' },
            ]}
            empty="Nenhum registro de ponto."
          />
        </TabsContent>

        <TabsContent value="escala" className="mt-4">
          <SimpleTable
            title="Escalas"
            rows={schedules}
            columns={[
              { key: 'date', label: 'Data', render: (r) => formatBR(r.date) },
              { key: 'day_type', label: 'Tipo' },
              { key: 'start_time', label: 'Início' },
              { key: 'end_time', label: 'Fim' },
              { key: 'sector', label: 'Setor' },
              { key: 'status', label: 'Status' },
            ]}
            empty="Nenhuma escala cadastrada."
          />
        </TabsContent>

        <TabsContent value="faltas" className="mt-4">
          <SectionHeader title="Ocorrências de frequência" onNew={canRegisterOccurrences ? () => openForm('absence') : null} />
          <SimpleTable
            rows={absences}
            columns={[
              { key: 'date', label: 'Data', render: (r) => formatBR(r.date) },
              { key: 'type', label: 'Tipo', render: (r) => <Badge style={ABSENCE_TYPES[r.type]?.style} label={ABSENCE_TYPES[r.type]?.label || r.type} /> },
              { key: 'expected_time', label: 'Previsto' },
              { key: 'actual_time', label: 'Realizado' },
              { key: 'reason', label: 'Motivo' },
              { key: 'responsible_user', label: 'Responsável' },
              { key: 'actions', label: '', render: (r) => canRegisterOccurrences ? (
                <div className="flex items-center gap-1">
                  <button onClick={() => openForm('absence', r)} className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => deleteAbsence(r)} className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              ) : null },
            ]}
            empty="Nenhuma ocorrência registrada."
          />
        </TabsContent>

        <TabsContent value="vales" className="mt-4">
          <SectionHeader title="Vales" onNew={canRegisterOccurrences ? () => openForm('vale') : null} extra={`Total: ${brl(vales.reduce((s, v) => s + (v.amount || 0), 0))}`} />
          <SimpleTable
            rows={vales}
            columns={[
              { key: 'date', label: 'Data', render: (r) => formatBR(r.date) },
              { key: 'amount', label: 'Valor', render: (r) => brl(r.amount) },
              { key: 'motive', label: 'Motivo' },
              { key: 'authorized_by', label: 'Autorizou' },
              { key: 'status', label: 'Status', render: (r) => <Badge style={VALE_STATUS[r.status]?.style} label={VALE_STATUS[r.status]?.label || r.status} /> },
              { key: 'actions', label: '', render: (r) => canRegisterOccurrences ? (
                <div className="flex items-center gap-1">
                  <button onClick={() => openForm('vale', r)} className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => deleteVale(r)} className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              ) : null },
            ]}
            empty="Nenhum vale registrado."
          />
        </TabsContent>

        <TabsContent value="consumo" className="mt-4">
          <SectionHeader title="Consumo interno" onNew={canRegisterOccurrences ? () => openForm('consumo') : null} extra={`Total: ${brl(consumptions.reduce((s, c) => s + (c.amount || 0), 0))}`} />
          <SimpleTable
            rows={consumptions}
            columns={[
              { key: 'date', label: 'Data', render: (r) => formatBR(r.date) },
              { key: 'product', label: 'Produto' },
              { key: 'quantity', label: 'Qtd' },
              { key: 'amount', label: 'Valor', render: (r) => brl(r.amount) },
              { key: 'registered_by', label: 'Lançado por' },
              { key: 'status', label: 'Status', render: (r) => <Badge style={CONSUMPTION_STATUS[r.status]?.style} label={CONSUMPTION_STATUS[r.status]?.label || r.status} /> },
              { key: 'actions', label: '', render: (r) => canRegisterOccurrences ? (
                <div className="flex items-center gap-1">
                  <button onClick={() => openForm('consumo', r)} className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => deleteConsumption(r)} className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              ) : null },
            ]}
            empty="Nenhum consumo registrado."
          />
        </TabsContent>

        <TabsContent value="pagamentos" className="mt-4">
          <SectionHeader title="Pagamentos do colaborador" onNew={canViewSensitive ? () => openForm('payment') : null} extra={`Total pago: ${brl(payments.filter((p) => p.status === 'pago').reduce((s, p) => s + Number(p.net_amount || 0), 0))}`} />
          <SimpleTable
            rows={payments}
            columns={[
              { key: 'payment_date', label: 'Data', render: (r) => formatBR(r.payment_date || r.work_date || r.reference_start) },
              { key: 'payment_type', label: 'Tipo', render: (r) => PAYMENT_TYPE_LABELS[r.payment_type] || r.payment_type },
              { key: 'reference', label: 'Referência', render: (r) => r.work_date ? formatBR(r.work_date) : [formatBR(r.reference_start), formatBR(r.reference_end)].filter(Boolean).join(' a ') || '—' },
              { key: 'gross_amount', label: 'Valor bruto', render: (r) => brl(r.gross_amount) },
              { key: 'discount_amount', label: 'Descontos', render: (r) => brl(r.discount_amount) },
              { key: 'net_amount', label: 'Valor líquido', render: (r) => brl(r.net_amount) },
              { key: 'status', label: 'Status', render: (r) => PAYMENT_STATUS_LABELS[r.status] || r.status },
              { key: 'proof_url', label: 'Comprovante', render: (r) => r.proof_url ? <a className="text-emerald-700 underline" href={r.proof_url} target="_blank" rel="noreferrer">Abrir</a> : '—' },
              { key: 'actions', label: '', render: (r) => canViewSensitive ? (
                <div className="flex items-center gap-1">
                  <button onClick={() => openForm('payment', r)} className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => deletePayment(r)} className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              ) : null },
            ]}
            empty="Nenhum pagamento registrado para este colaborador."
          />
        </TabsContent>

        <TabsContent value="advertencias" className="mt-4">
          <SectionHeader title="Ocorrências disciplinares" onNew={canRegisterOccurrences ? () => openForm('warning') : null} />
          <SimpleTable
            rows={warnings}
            columns={[
              { key: 'date', label: 'Data', render: (r) => formatBR(r.date) },
              { key: 'category', label: 'Categoria', render: (r) => WARNING_CATEGORIES[r.category] || r.category },
              { key: 'description', label: 'Descrição' },
              { key: 'responsible_user', label: 'Responsável' },
              { key: 'status', label: 'Status', render: (r) => <Badge style={WARNING_STATUS[r.status]?.style} label={WARNING_STATUS[r.status]?.label || r.status} /> },
            ]}
            empty="Nenhuma ocorrência disciplinar."
          />
        </TabsContent>

        <TabsContent value="avaliacoes" className="mt-4">
          <SectionHeader title="Avaliações de desempenho" onNew={canRegisterOccurrences ? () => openForm('evaluation') : null} />
          <SimpleTable
            rows={evaluations}
            columns={[
              { key: 'date', label: 'Data', render: (r) => formatBR(r.date) },
              { key: 'period', label: 'Período' },
              { key: 'score', label: 'Nota' },
              { key: 'evaluator', label: 'Avaliador' },
              { key: 'notes', label: 'Anotações' },
            ]}
            empty="Nenhuma avaliação registrada."
          />
        </TabsContent>

        <TabsContent value="documentos" className="mt-4">
          <SectionHeader title="Documentos" onNew={canViewSensitive ? () => openForm('document') : null} />
          <SimpleTable
            rows={documents}
            columns={[
              { key: 'name', label: 'Nome' },
              { key: 'category', label: 'Categoria', render: (r) => DOC_CATEGORIES[r.category] || r.category },
              { key: 'date', label: 'Data', render: (r) => formatBR(r.date) },
              { key: 'uploaded_by', label: 'Anexado por' },
              { key: 'file_url', label: 'Arquivo', render: (r) => r.file_url ? <a href={r.file_url} target="_blank" rel="noreferrer" className="text-amber-600 underline">Ver</a> : '—' },
            ]}
            empty="Nenhum documento anexado."
          />
        </TabsContent>

        {canSangria(employee.name) && (
          <TabsContent value="sangrias" className="mt-4">
            <SectionHeader title="Sangrias do colaborador" onNew={() => setSangriaOpen(true)} extra={`Total: ${brl(employeeSangrias.reduce((s, r) => s + (r.status === 'ativo' ? Number(r.amount || 0) : 0), 0))}`} />
            <SimpleTable
              rows={employeeSangrias}
              columns={[
                { key: 'date', label: 'Data', render: (r) => formatBR(r.date) },
                { key: 'cashier', label: 'Caixa', render: (r) => r.cashier === 'caixa_2' ? 'Caixa 2' : 'Caixa 1' },
                { key: 'amount', label: 'Valor', render: (r) => brl(r.amount) },
                { key: 'purpose', label: 'Intuito/Motivo' },
                { key: 'destination', label: 'Destino' },
                { key: 'operator_name', label: 'Operador do caixa' },
                { key: 'status', label: 'Status', render: (r) => <Badge style={r.status === 'ativo' ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-slate-200 text-slate-500 bg-slate-50'} label={r.status === 'ativo' ? 'Ativo' : 'Cancelado'} /> },
              ]}
              empty="Nenhuma sangria registrada para este colaborador."
            />
          </TabsContent>
        )}

        <TabsContent value="historico" className="mt-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-slate-800 mb-4">Linha do tempo do colaborador</h3>
            <EmployeeTimeline employeeId={id} />
          </div>
        </TabsContent>
      </Tabs>

      {/* Formulários modais */}
      <EmployeeForm open={editOpen} onOpenChange={setEditOpen} employee={employee} onSaved={load} sectors={sectors} roles={roles} />
      <AbsenceForm open={formState.type === 'absence'} onOpenChange={closeForm} employees={[employee]} onSaved={load} editing={formState.editing} defaultEmployeeId={id} />
      <ValeForm open={formState.type === 'vale'} onOpenChange={closeForm} employees={[employee]} onSaved={load} editing={formState.editing} />
      <ConsumptionForm open={formState.type === 'consumo'} onOpenChange={closeForm} employees={[employee]} onSaved={load} editing={formState.editing} />
      <WarningForm open={formState.type === 'warning'} onOpenChange={closeForm} employees={[employee]} onSaved={load} editing={formState.editing} />
      <DocumentForm open={formState.type === 'document'} onOpenChange={closeForm} employee={employee} onSaved={load} />
      <EvaluationForm open={formState.type === 'evaluation'} onOpenChange={closeForm} employee={employee} onSaved={load} editing={formState.editing} />
      <PaymentForm open={formState.type === 'payment'} onOpenChange={closeForm} employee={employee} onSaved={load} editing={formState.editing} />
      <SangriaDialog open={sangriaOpen} presetResponsible={employee?.name || ''} onClose={() => setSangriaOpen(false)} onSaved={load} />
    </div>
  );
}

function SectionHeader({ title, onNew, extra }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-slate-800">{title}</h3>
        {extra && <span className="text-sm text-slate-500">{extra}</span>}
      </div>
      {onNew && <Button size="sm" onClick={onNew}>+ Novo</Button>}
    </div>
  );
}

function Badge({ style, label }) {
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${style || ''}`}>{label}</span>;
}

function SimpleTable({ rows, columns, empty = 'Nenhum registro.', title }) {
  if (!rows || rows.length === 0) return <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-400 text-sm">{empty}</div>;
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {title && <div className="px-4 py-2.5 border-b border-slate-100 text-sm font-medium text-slate-700">{title}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>{columns.map((c) => <th key={c.key} className="text-left font-medium px-4 py-2.5">{c.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/60">
                {columns.map((c) => <td key={c.key} className="px-4 py-2.5 text-slate-700">{c.render ? c.render(r) : (r[c.key] ?? '—')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VisaoGeral({ employee, canViewSensitive }) {
  const rows = [
    ['Função', employee.function], ['Setor', employee.sector], ['Unidade', employee.unit],
    ['Tipo de contratação', HIRE_TYPE_LABELS[employee.hire_type] || employee.hire_type],
    ['Responsável direto', employee.responsible], ['Status', EMPLOYEE_STATUS[employee.status]?.label || employee.status],
    ['Data de entrada', formatBR(employee.admission_date)], ['Tempo de empresa', tenure(employee.admission_date)],
    ['Horário padrão', employee.default_start_time ? `${employee.default_start_time}–${employee.default_end_time || ''}` : null],
    ['Dias de trabalho', employee.work_days], ['Dia de folga', employee.day_off],
    ['Telefone', employee.phone], ['WhatsApp', employee.whatsapp],
    ['Contato de emergência', employee.emergency_contact], ['Telefone de emergência', employee.emergency_phone],
  ];
  const adminRows = canViewSensitive ? [
    ['CPF', employee.cpf], ['RG', employee.rg], ['Endereço', [employee.address, employee.neighborhood, employee.city, employee.state].filter(Boolean).join(', ')],
    ['Salário/Diária', employee.salary != null ? brl(employee.salary) : null], ['Chave Pix', employee.pix_key], ['Banco', employee.bank],
    ['Uniformes entregues', employee.uniforms_delivered], ['Observações', employee.observations],
    ['Início experiência', formatBR(employee.experience_start)], ['Fim experiência', formatBR(employee.experience_end)],
  ] : [];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
        {[...rows, ...adminRows].filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-slate-50 py-1.5">
            <span className="text-sm text-slate-500">{k}</span>
            <span className="text-sm text-slate-800 text-right">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}