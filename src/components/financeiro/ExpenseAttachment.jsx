import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import AttachmentPreview from '@/components/rh/AttachmentPreview';
import {
  expenseAttachmentRecord, validateExpenseAttachmentFile,
  EXPENSE_ATTACHMENT_ACCEPT, EXPENSE_ATTACHMENT_DIAG, EXPENSE_ATTACHMENT_ERROR,
  EXPENSE_ATTACHMENT_PREFIX,
} from '@/lib/expenseAttachment';

// Data URL nunca é aberta direto: o AttachmentPreview converte para Blob e
// usa URL.createObjectURL, exibindo <img> para imagem e <iframe> para PDF.
export function ExpenseAttachment({ record, field = 'proof_url', label = 'Ver comprovante' }) {
  const attachment = expenseAttachmentRecord(record, field);
  if (!attachment) return null;
  return <AttachmentPreview record={attachment} label={label} title={label}
    prefix={EXPENSE_ATTACHMENT_PREFIX} diagLabel={EXPENSE_ATTACHMENT_DIAG} sourceField={field} />;
}

export function ExpenseAttachmentUpload({ label, record, field = 'proof_url', busy, refEl, onFile }) {
  const [error, setError] = useState('');
  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // permite reenviar o mesmo arquivo
    if (!file) return;
    setError('');
    try {
      await validateExpenseAttachmentFile(file);
      await onFile(file);
    } catch (err) {
      const message = err?.message || EXPENSE_ATTACHMENT_ERROR;
      console.error(EXPENSE_ATTACHMENT_DIAG, 'ERRO', { status: null, code: 'UPLOAD_FAILED', message });
      setError(message);
    }
  };
  return <div className="space-y-1">
    <Label className="text-xs">{label}</Label>
    <input ref={refEl} type="file" className="hidden" accept={EXPENSE_ATTACHMENT_ACCEPT} onChange={upload} />
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => refEl.current?.click()} disabled={busy} className="gap-2">
        <Upload className="w-4 h-4" />{busy ? 'Enviando...' : record?.[field] ? 'Trocar arquivo' : 'Anexar arquivo'}
      </Button>
      <ExpenseAttachment record={record} field={field} label={field === 'invoice_url' ? 'Ver nota fiscal' : 'Ver comprovante'} />
      <span className="text-xs text-slate-400">JPG, JPEG, PNG, WEBP ou PDF</span>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}
