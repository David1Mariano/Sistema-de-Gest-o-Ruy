// Comprovante do gasto diário.
//
// Reaproveita a infraestrutura JÁ validada do projeto:
// - `validatePayableAttachmentFile` (mesmas regras de JPG/JPEG/PNG/WEBP/PDF,
//   mesma checagem de extensão disfarçada e de conteúdo real);
// - `AttachmentPreview`, que faz Data URL -> Blob -> URL.createObjectURL,
//   exibe imagem em <img> e PDF em <iframe>, e revoga a Object URL no cleanup.
//
// O prefixo de Storage é apenas leitura de compatibilidade: nada é gravado no
// bucket e nenhuma policy é criada. Nenhuma migration roda aqui.
import { validatePayableAttachmentFile } from './payableAttachment.js';

export const EXPENSE_ATTACHMENT_DIAG = '[gasto-diario-comprovante]';
export const EXPENSE_ATTACHMENT_PREFIX = 'FinancialExpense';
export const EXPENSE_ATTACHMENT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf';

// Um gasto tem um comprovante (`proof_url`) e, separadamente, a nota fiscal
// (`invoice_url`). São dois anexos independentes: não escondemos um quando o
// outro existe.
export const EXPENSE_ATTACHMENT_FIELDS = ['proof_url', 'invoice_url', 'storage_path'];

// Só devolve um registro quando o campo realmente existe com conteúdo. Campo
// não confirmado não é inferido a partir de outro.
export function expenseAttachmentRecord(record = {}, field = 'proof_url') {
  if (!EXPENSE_ATTACHMENT_FIELDS.includes(field) || !record[field]) return null;
  return {
    id: record.id,
    proof_url: field === 'storage_path' ? '' : record[field],
    storage_path: field === 'storage_path' ? record.storage_path : '',
    file_name: field === 'storage_path' ? record.file_name : undefined,
    mime_type: field === 'storage_path' ? record.mime_type : undefined,
    file_size: field === 'storage_path' ? record.file_size : undefined,
  };
}

export const hasExpenseAttachment = (record = {}, field = 'proof_url') => Boolean(expenseAttachmentRecord(record, field));

export async function validateExpenseAttachmentFile(file) {
  return validatePayableAttachmentFile(file);
}

export const EXPENSE_ATTACHMENT_ERROR = 'Não foi possível anexar o arquivo. Use JPG, JPEG, PNG, WEBP ou PDF válido e tente novamente.';
