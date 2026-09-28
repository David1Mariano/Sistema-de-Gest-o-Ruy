import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { loadPaymentProof, PAYMENT_PROOF_DIAG } from '@/lib/paymentProof';

// Visualização genérica de comprovantes/anexos. Serve para qualquer entidade
// que guarde `proof_url` (base64 legado) e/ou `storage_path` (bucket privado).
// Data URL NUNCA é aberta direto: sempre vira Blob -> URL.createObjectURL.
export default function AttachmentPreview({
  record = {},
  label = 'Ver comprovante',
  title,
  prefix,
  diagLabel = PAYMENT_PROOF_DIAG,
  sourceField,
  className = 'text-xs text-emerald-700 underline',
} = {}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');

  const previewFailed = (message) => {
    if (sourceField) console.error(diagLabel, 'ERRO', { status: null, code: 'PREVIEW_FAILED', message });
    setError(message);
  };

  const hasProof = Boolean(record?.proof_url || record?.storage_path);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    let objectUrl;
    setPreview(null);
    setError('');
    console.info(diagLabel, 'preview: carregando', {
      recordId: record?.id || null,
      tipo: record?.storage_path ? 'storage' : 'legacy',
      mimeType: record?.mime_type || null,
      storagePath: record?.storage_path || null,
    });
    loadPaymentProof(record, { signal: controller.signal, prefix, diagLabel }).then((blob) => {
      if (controller.signal.aborted) return;
      // Revoga SOMENTE no cleanup (fechar/desmontar), nunca antes do preview.
      objectUrl = URL.createObjectURL(blob);
      console.info(diagLabel, 'preview: blob criado', { mimeType: blob.type, bytes: blob.size });
      setPreview({ url: objectUrl, type: blob.type });
    }).catch((err) => {
      if (controller.signal.aborted) return;
      console.error(diagLabel, 'ERRO', { message: err?.message || String(err), status: err?.status ?? null, code: err?.code ?? null });
      setError(err.message);
    });
    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        console.info(diagLabel, 'preview: blob URL revogada');
      }
    };
  }, [open, record?.proof_url, record?.storage_path]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasProof) return null;
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => { console.info(diagLabel, 'preview: clique', { recordId: record?.id || null, campoUtilizado: sourceField, tipo: record?.storage_path ? 'storage' : 'legacy' }); setPreview(null); setError(''); setOpen(true); }}
      >
        {label}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{title || record?.file_name || 'Comprovante'}</DialogTitle>
          </DialogHeader>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {!preview && !error && <p role="status">Carregando comprovante...</p>}
          {open && preview && !error && (preview.type === 'application/pdf'
            ? <iframe title="Comprovante PDF" src={preview.url} className="w-full h-[70vh] border-0" onLoad={() => sourceField && console.info(diagLabel, 'preview carregado', { mimeType: preview.type })} onError={() => previewFailed('O navegador não conseguiu exibir o PDF.')} />
            : <img alt="Comprovante" src={preview.url} className="max-h-[70vh] max-w-full object-contain mx-auto" onLoad={() => sourceField && console.info(diagLabel, 'preview carregado', { mimeType: preview.type })} onError={() => previewFailed('O navegador não conseguiu decodificar a imagem do comprovante.')} />)}
        </DialogContent>
      </Dialog>
    </>
  );
}
