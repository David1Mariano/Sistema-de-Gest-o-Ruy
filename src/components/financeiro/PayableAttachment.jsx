import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import AttachmentPreview from '@/components/rh/AttachmentPreview';
import {
  payableAttachmentRecord, validatePayableAttachmentFile,
  PAYABLE_ATTACHMENT_ACCEPT, PAYABLE_ATTACHMENT_DIAG,
} from '@/lib/payableAttachment';

export function PayableAttachment({ record, field, label = 'Abrir' }) {
  const attachment = payableAttachmentRecord(record, field);
  if (!attachment) return null;
  return <AttachmentPreview record={attachment} label={label} title={label}
    prefix="AccountsPayable" diagLabel={PAYABLE_ATTACHMENT_DIAG} sourceField={field} />;
}

// Upload continua usando o fluxo existente; só valida o formato e adapta o preview.
export function PayableAttachmentUpload({ label, record, field, busy, refEl, onFile }) {
  const [error, setError] = useState('');
  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    try {
      await validatePayableAttachmentFile(file);
      await onFile(file);
    } catch {
      const message = 'Não foi possível anexar o arquivo. Use JPG, JPEG, PNG, WEBP ou PDF válido e tente novamente.';
      console.error(PAYABLE_ATTACHMENT_DIAG, 'ERRO', { status: null, code: 'UPLOAD_FAILED', message });
      setError(message);
    }
  };
  return <div className="space-y-1">
    <Label className="text-xs">{label}</Label>
    <input ref={refEl} type="file" className="hidden" accept={PAYABLE_ATTACHMENT_ACCEPT} onChange={upload} />
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => refEl.current?.click()} disabled={busy} className="gap-2">
        <Upload className="w-4 h-4" />{busy ? 'Enviando...' : record?.[field] ? 'Trocar arquivo' : 'Anexar arquivo'}
      </Button>
      <PayableAttachment record={record} field={field} label={label === 'Comprovante' ? 'Ver comprovante' : 'Ver documento'} />
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}
