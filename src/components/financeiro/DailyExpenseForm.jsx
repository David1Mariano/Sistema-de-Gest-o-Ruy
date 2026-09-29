import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import NumberInput from '@/components/shared/NumberInput';
import DraftNotice from '@/components/shared/DraftNotice';
import { base44 } from '@/api/base44Client';
import { currentUserName } from '@/lib/useCurrentUser';
import { usePersistentDraft } from '@/lib/usePersistentDraft';
import { DRAFT_CANCEL_CONFIRM, DRAFT_FORM_KEYS, DRAFT_LABEL_FILE, draftEditKey } from '@/lib/draftConfig';
import { hasDraftChanged } from '@/lib/draftStore';
import { ExpenseAttachmentUpload } from '@/components/financeiro/ExpenseAttachment';
import {
  saveDailyExpense, validateExpenseForm, expenseToForm, emptyExpenseForm, newExpenseId,
  EXPENSE_CLASS_LABELS, EXPENSE_STATUS_LABELS,
  EXPENSE_BENEFICIARY_LABELS, expenseCategoryOptions, paymentMethodOptions, supplierNameOptions,
} from '@/lib/dailyExpenses';
import { toNumberBR } from '@/lib/numberUtils';

// Anexos NÃO entram no rascunho. `proof_url`/`invoice_url` são o resultado de
// um upload que já aconteceu; o File em si nunca está no estado. Guardar a URL
// no localStorage mostraria um comprovante possivelmente expirado como se
// fosse o anexado de agora, então o rascunho carrega o TEXTO e a tela avisa
// que o arquivo precisa ser escolhido de novo.
const CAMPOS_DE_ANEXO = ['proof_url', 'invoice_url'];

const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

const Field = ({ l, children, error }) => <div className="space-y-1">
  <Label className="text-xs">{l}</Label>
  {children}
  {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
</div>;

const Select = ({ v, on, opts }) => <select className={inputCls} value={v || ''} onChange={(e) => on(e.target.value)}>
  {v ? null : <option value="">Selecione...</option>}
  {opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
</select>;

// Valor: usa o NumberInput compartilhado (integrado pelo Agente 1) em vez de
// uma segunda máscara de dinheiro. Ele já resolve a vírgula decimal pt-BR e
// entrega NÚMERO ao estado — que é o que `buildExpensePayload` espera.
const CurrencyInput = ({ value, onChange, error }) => <NumberInput
  value={value}
  onChange={onChange}
  placeholder="0,00"
  fractionDigits={2}
  className="h-9"
  aria-invalid={error ? 'true' : undefined}
  aria-label="Valor do gasto" />;


export default function DailyExpenseForm({ open, onClose, onSaved, data, editing }) {
  const [form, setForm] = useState(emptyExpenseForm());
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState('');
  const [failure, setFailure] = useState('');
  // Id estável por tentativa de criação: se o pagamento do colaborador falhar
  // e o usuário tentar de novo, o mesmo id é reenviado e o `create` faz upsert
  // do MESMO gasto em vez de duplicar.
  const pendingId = useRef('');
  const proofRef = useRef();
  const invoiceRef = useRef();

  // Rascunho local. Chave por usuário + por formulário; em edição o id do
  // gasto entra na chave para não misturar dois registros. Anexos ficam de
  // fora (ver CAMPOS_DE_ANEXO).
  const draftKey = draftEditKey(
    editing ? DRAFT_FORM_KEYS.FINANCEIRO_GASTO_EDIT : DRAFT_FORM_KEYS.FINANCEIRO_GASTO_NOVO,
    editing?.id,
  );
  const draft = usePersistentDraft({
    formKey: draftKey,
    enabled: open,
    value: form,
    excludeFields: CAMPOS_DE_ANEXO,
    recordUpdatedAt: editing?.updated_at,
  });

  useEffect(() => {
    if (!open) return;
    // `restoreInto` devolve o baseline já com o rascunho por cima (ou o
    // baseline intacto). O rascunho é aplicado AQUI, dentro do mesmo reset que
    // já existia — por isso o efeito do hook não precisa competir de ordem
    // com este.
    setForm(draft.restoreInto(editing ? expenseToForm(editing) : emptyExpenseForm()));
    setErrors({});
    setFailure('');
    setUploading('');
    pendingId.current = '';
  }, [open, editing, draft.restoreInto]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const upload = async (file, key) => {
    if (!file) return;
    setUploading(key);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      set(key, file_url);
    } catch {
      setFailure('Não foi possível enviar o arquivo. Tente novamente.');
    } finally { setUploading(''); }
  };

  const save = async () => {
    const { valid, errors: found } = validateExpenseForm(form, { employees: data.employees });
    setErrors(found);
    if (!valid) return;
    setSaving(true);
    setFailure('');
    // Na criação, o id nasce aqui e vale para todas as tentativas até dar certo.
    const attemptForm = editing ? form : { ...form, expense_id: pendingId.current || (pendingId.current = newExpenseId()) };
    try {
      await saveDailyExpense({
        entities: base44.entities,
        form: attemptForm,
        editing,
        categories: data.categories,
        centers: data.centers,
        employees: data.employees,
        responsibleUser: currentUserName(),
        payments: data.payments,
      });
      pendingId.current = '';
      // O backend CONFIRMOU. Só agora o rascunho sai — antes disso ele é a
      // única cópia do que a pessoa digitou.
      draft.markSaved();
      onClose();
      await onSaved();
    } catch (err) {
      // `pendingId` é mantido de propósito: a próxima tentativa reenvia o mesmo
      // id, então o `create` atualiza o gasto existente em vez de duplicá-lo.
      // O rascunho também é mantido, pela mesma razão.
      draft.markFailed();
      setFailure(err?.message || 'Não foi possível salvar o gasto. Tente novamente.');
    } finally { setSaving(false); }
  };

  // Cancelar nunca apaga sozinho. Se houver algo digitado, a decisão é da
  // pessoa: descartar o rascunho ou guardar para continuar depois.
  const requestClose = () => {
    if (saving) return;
    if (hasDraftChanged(form, editing ? expenseToForm(editing) : emptyExpenseForm())
      && window.confirm(DRAFT_CANCEL_CONFIRM)) {
      draft.discard();
    } else {
      draft.keep();
    }
    onClose();
  };

  const activeCategories = expenseCategoryOptions(data.categories);
  const suppliers = supplierNameOptions(data.suppliers);
  const employees = (data.employees || []).filter((employee) => employee.status !== 'inativo');
  const canSave = Boolean(form.description?.trim()) && toNumberBR(form.amount) > 0;
  const hasFile = Boolean(form.proof_url || form.invoice_url);
  const hint = hasFile ? DRAFT_LABEL_FILE : undefined;

  return <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) requestClose(); }}>
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
      <DialogHeader>
        <DialogTitle>{editing ? 'Editar gasto diário' : 'Novo gasto diário'}</DialogTitle>
        <p className="text-sm text-slate-500">Preencha os dados e salve. O comprovante é opcional.</p>
      </DialogHeader>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field l="Data do gasto *" error={errors.date}>
          <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field l="Situação">
          <Select v={form.status} on={(v) => set('status', v)} opts={Object.entries(EXPENSE_STATUS_LABELS)} />
        </Field>
        <div className="sm:col-span-2">
          <Field l="Descrição *" error={errors.description}>
            <Input value={form.description} onChange={(e) => set('description', e.target.value)}
              placeholder="Ex.: Compra de queijo, gás, manutenção..." />
          </Field>
        </div>
        <Field l="Valor *" error={errors.amount}>
          <CurrencyInput value={form.amount} onChange={(v) => set('amount', v)} error={errors.amount} />
        </Field>
        <Field l="Forma de pagamento">
          <Select v={form.payment_method} on={(v) => set('payment_method', v)} opts={paymentMethodOptions()} />
        </Field>
        <Field l="Categoria">
          <Select v={form.category_id} on={(v) => set('category_id', v)} opts={activeCategories.map((c) => [c.id, c.name])} />
        </Field>
        <Field l="Classificação">
          <Select v={form.classification} on={(v) => set('classification', v)} opts={Object.entries(EXPENSE_CLASS_LABELS)} />
        </Field>
        <Field l="Centro de custo">
          <Select v={form.cost_center_id} on={(v) => set('cost_center_id', v)} opts={(data.centers || []).filter((c) => c.status === 'ativo').map((c) => [c.id, c.name])} />
        </Field>
        <Field l="Favorecido">
          <Select v={form.beneficiary_type}
            on={(v) => { set('beneficiary_type', v); set('employee_id', ''); set('beneficiary_name', ''); }}
            opts={Object.entries(EXPENSE_BENEFICIARY_LABELS)} />
        </Field>
        {form.beneficiary_type === 'colaborador' && <Field l="Colaborador *" error={errors.employee_id}>
          <Select v={form.employee_id} on={(v) => { set('employee_id', v); set('beneficiary_name', employees.find((e) => e.id === v)?.name || ''); }}
            opts={employees.map((employee) => [employee.id, employee.function ? `${employee.name} · ${employee.function}` : employee.name])} />
        </Field>}
        {form.beneficiary_type === 'fornecedor' && <Field l="Fornecedor / Estabelecimento">
          <Input list="gasto-fornecedores" value={form.beneficiary_name} onChange={(e) => set('beneficiary_name', e.target.value)} placeholder="Ex.: Hortifruti da esquina" />
          <datalist id="gasto-fornecedores">{suppliers.map((name) => <option key={name} value={name} />)}</datalist>
        </Field>}
        {form.status === 'pago' && <Field l="Data do pagamento" error={errors.paid_date}>
          <Input type="date" value={form.paid_date || ''} onChange={(e) => set('paid_date', e.target.value)} />
        </Field>}
        <Field l="Conta">
          <Select v={form.account} on={(v) => set('account', v)} opts={(data.accounts || []).map((a) => [a.name, a.name])} />
        </Field>
        <div className="sm:col-span-2">
          <Field l="Observação">
            <Textarea rows={2} value={form.observation} onChange={(e) => set('observation', e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <ExpenseAttachmentUpload label="Comprovante" record={form} field="proof_url" busy={uploading === 'proof_url'} refEl={proofRef} onFile={(file) => upload(file, 'proof_url')} />
        </div>
        <div className="sm:col-span-2">
          <ExpenseAttachmentUpload label="Nota fiscal (opcional)" record={form} field="invoice_url" busy={uploading === 'invoice_url'} refEl={invoiceRef} onFile={(file) => upload(file, 'invoice_url')} />
        </div>
      </div>
      {failure && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{failure}</p>}
      <DraftNotice
        status={draft.status}
        message={draft.message}
        hint={hint}
        onDiscard={draft.discard}
        onDismiss={draft.dismissNotice} />
      <DialogFooter>
        <Button variant="outline" onClick={requestClose} disabled={saving}>Cancelar</Button>
        <Button onClick={save} disabled={saving || !canSave}>{saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Registrar gasto'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
