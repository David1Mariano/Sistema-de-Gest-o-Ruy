import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';
import { useUserRole } from '@/lib/useUserRole';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { HIRE_TYPE_LABELS } from '@/lib/rhUtils';
import { Upload, User, Briefcase, Shield } from 'lucide-react';

const empty = {
  name: '', social_name: '', birth_date: '', cpf: '', rg: '', phone: '', whatsapp: '',
  address: '', neighborhood: '', city: '', state: '', emergency_contact: '', emergency_phone: '', photo_url: '',
  sector: '', function: '', unit: '', hire_type: 'clt', status: 'ativo', admission_date: '',
  default_start_time: '', default_end_time: '', work_days: '', day_off: '', salary: null, vale_value: null,
  responsible: '', experience_start: '', experience_end: '', pix_key: '', bank: '', observations: '', uniforms_delivered: '',
};

function Section({ icon: Icon, title, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-slate-700 font-medium text-sm">
        <Icon className="w-4 h-4 text-amber-500" /> {title}
      </div>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <div className={`space-y-1 ${full ? 'col-span-2' : ''}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

export default function EmployeeForm({ open, onOpenChange, employee, onSaved, sectors = [], roles = [] }) {
  const { canViewSensitive, canManageEmployees } = useUserRole();
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) setForm({ ...empty, ...(employee || {}) });
  }, [open, employee]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      set('photo_url', file_url);
    } finally { setUploading(false); }
  };

  const save = async () => {
    if (!form.name?.trim()) return;
    setSaving(true);
    try {
      const payload = { ...form };
      if (employee?.id) {
        // registra alterações campo a campo nos dados sensíveis/principais
        const tracked = ['name', 'sector', 'function', 'unit', 'status', 'hire_type', 'default_start_time', 'default_end_time', 'salary', 'responsible'];
        for (const k of tracked) {
          if (String(employee[k] ?? '') !== String(payload[k] ?? '')) {
            await logAudit({
              entity_type: 'Employee', entity_id: employee.id, action: 'alteracao',
              field: k, old_value: employee[k] ?? '', new_value: payload[k] ?? '',
              responsible_user: currentUserName(),
            });
          }
        }
        const updated = await base44.entities.Employee.update(employee.id, payload);
        onSaved?.(updated);
      } else {
        const created = await base44.entities.Employee.create(payload);
        await logAudit({
          entity_type: 'Employee', entity_id: created.id, action: 'criacao',
          new_value: form.name, responsible_user: currentUserName(),
        });
        onSaved?.(created);
      }
      onOpenChange?.(false);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{employee ? 'Editar colaborador' : 'Novo colaborador'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Foto */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center border border-slate-200">
              {form.photo_url
                ? <img src={form.photo_url} alt="" className="w-full h-full object-cover" />
                : <User className="w-6 h-6 text-slate-400" />}
            </div>
            <div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <Upload className="w-4 h-4" /> {uploading ? 'Enviando...' : 'Enviar foto'}
              </Button>
            </div>
          </div>

          <Section icon={User} title="Dados pessoais">
            <Field label="Nome completo *"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Nome social/apelido"><Input value={form.social_name} onChange={(e) => set('social_name', e.target.value)} /></Field>
            <Field label="Data de nascimento"><Input type="date" value={form.birth_date} onChange={(e) => set('birth_date', e.target.value)} /></Field>
            <Field label="Telefone"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(00) 00000-0000" /></Field>
            <Field label="WhatsApp"><Input value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></Field>
            <Field label="Contato de emergência"><Input value={form.emergency_contact} onChange={(e) => set('emergency_contact', e.target.value)} /></Field>
            <Field label="Telefone de emergência"><Input value={form.emergency_phone} onChange={(e) => set('emergency_phone', e.target.value)} /></Field>
            {canViewSensitive && (<>
              <Field label="CPF"><Input value={form.cpf} onChange={(e) => set('cpf', e.target.value)} /></Field>
              <Field label="RG"><Input value={form.rg} onChange={(e) => set('rg', e.target.value)} /></Field>
              <Field label="Endereço" full><Input value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
              <Field label="Bairro"><Input value={form.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} /></Field>
              <Field label="Cidade"><Input value={form.city} onChange={(e) => set('city', e.target.value)} /></Field>
              <Field label="Estado"><Input value={form.state} onChange={(e) => set('state', e.target.value)} placeholder="UF" /></Field>
            </>)}
          </Section>

          <Section icon={Briefcase} title="Dados profissionais">
            <Field label="Data de entrada"><Input type="date" value={form.admission_date} onChange={(e) => set('admission_date', e.target.value)} /></Field>
            <Field label="Setor">
              <select className={inputCls} value={form.sector} onChange={(e) => set('sector', e.target.value)}>
                <option value="">Selecione</option>
                {sectors.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                {form.sector && !sectors.some((s) => s.name === form.sector) && <option value={form.sector}>{form.sector}</option>}
              </select>
            </Field>
            <Field label="Função">
              <select className={inputCls} value={form.function} onChange={(e) => set('function', e.target.value)}>
                <option value="">Selecione</option>
                {roles.filter((r) => !form.sector || r.sector_name === form.sector).map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
                {form.function && !roles.some((r) => r.name === form.function) && <option value={form.function}>{form.function}</option>}
              </select>
            </Field>
            <Field label="Unidade"><Input value={form.unit} onChange={(e) => set('unit', e.target.value)} /></Field>
            <Field label="Tipo de contratação">
              <select className={inputCls} value={form.hire_type} onChange={(e) => set('hire_type', e.target.value)}>
                {Object.entries(HIRE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="ativo">Ativo</option>
                <option value="em_experiencia">Em experiência</option>
                <option value="folga">Folga</option>
                <option value="ferias">Férias</option>
                <option value="afastado">Afastado</option>
                <option value="desligado">Desligado</option>
                <option value="inativo">Inativo</option>
              </select>
            </Field>
            <Field label="Horário padrão (entrada)"><Input type="time" value={form.default_start_time || ''} onChange={(e) => set('default_start_time', e.target.value)} /></Field>
            <Field label="Horário padrão (saída)"><Input type="time" value={form.default_end_time || ''} onChange={(e) => set('default_end_time', e.target.value)} /></Field>
            <Field label="Dias de trabalho"><Input value={form.work_days} onChange={(e) => set('work_days', e.target.value)} placeholder="Ex: Seg-Sex" /></Field>
            <Field label="Dia de folga"><Input value={form.day_off} onChange={(e) => set('day_off', e.target.value)} placeholder="Ex: Sábado" /></Field>
            <Field label="Responsável direto"><Input value={form.responsible} onChange={(e) => set('responsible', e.target.value)} /></Field>
            <Field label="Início da experiência"><Input type="date" value={form.experience_start} onChange={(e) => set('experience_start', e.target.value)} /></Field>
            <Field label="Fim previsto da experiência"><Input type="date" value={form.experience_end} onChange={(e) => set('experience_end', e.target.value)} /></Field>
            {canViewSensitive && (<>
              <Field label="Salário/Diária"><Input type="number" value={form.salary ?? ''} onChange={(e) => set('salary', e.target.value ? Number(e.target.value) : null)} /></Field>
              <Field label="Valor do vale"><Input type="number" value={form.vale_value ?? ''} onChange={(e) => set('vale_value', e.target.value ? Number(e.target.value) : null)} /></Field>
            </>)}
          </Section>

          {canViewSensitive && (
            <Section icon={Shield} title="Dados administrativos">
              <Field label="Chave Pix"><Input value={form.pix_key} onChange={(e) => set('pix_key', e.target.value)} /></Field>
              <Field label="Banco"><Input value={form.bank} onChange={(e) => set('bank', e.target.value)} /></Field>
              <Field label="Uniformes entregues"><Input value={form.uniforms_delivered} onChange={(e) => set('uniforms_delivered', e.target.value)} /></Field>
              <Field label="Observações" full>
                <Textarea rows={2} value={form.observations} onChange={(e) => set('observations', e.target.value)} />
              </Field>
            </Section>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !form.name?.trim()}>
            {saving ? 'Salvando...' : 'Salvar colaborador'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}