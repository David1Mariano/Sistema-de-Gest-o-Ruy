import { Button } from '@/components/ui/button';
import { DRAFT_STATUS } from '@/lib/usePersistentDraft';

// Aviso discreto de rascunho. Fica no rodapé do formulário, acima dos botões.
//
// Regra de texto: NUNCA dizer apenas "Salvo". Um "Salvo" solto faz o usuário
// achar que o registro já está no banco — e ele só entra no banco quando o
// backend confirma. Por isso os rótulos dizem sempre "rascunho" e "localmente".
const TONE = {
  [DRAFT_STATUS.RESTORED]: 'border-amber-200 bg-amber-50 text-amber-900',
  [DRAFT_STATUS.SAVED]: 'border-slate-200 bg-slate-50 text-slate-600',
  [DRAFT_STATUS.STALE]: 'border-amber-200 bg-amber-50 text-amber-900',
  [DRAFT_STATUS.EXTERNAL]: 'border-sky-200 bg-sky-50 text-sky-900',
  [DRAFT_STATUS.DISCARDED]: 'border-slate-200 bg-slate-50 text-slate-600',
  [DRAFT_STATUS.UNAVAILABLE]: 'border-slate-200 bg-slate-50 text-slate-600',
};

export default function DraftNotice({
  status,
  message,
  onDiscard,
  onDismiss,
  hint,
}) {
  if (!status || !TONE[status] || !message) return null;

  return (
    <div
      className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs ${TONE[status]}`}
      role="status"
      aria-live="polite"
    >
      <span>{message}</span>
      {hint && status === DRAFT_STATUS.RESTORED && <span>{hint}</span>}
      {onDiscard && status === DRAFT_STATUS.RESTORED && (
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs underline" onClick={onDiscard}>
          Descartar rascunho
        </Button>
      )}
      {onDismiss && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs underline"
          onClick={onDismiss}
          aria-label="Fechar aviso de rascunho"
        >
          Fechar
        </Button>
      )}
    </div>
  );
}
