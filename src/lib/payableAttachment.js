import { PAYMENT_PROOF_TYPES, validateContent } from './paymentProof.js';

export const PAYABLE_ATTACHMENT_DIAG = '[contas-pagar-comprovante]';
export const PAYABLE_ATTACHMENT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf';

// Cada campo representa um anexo independente. Não confundir o documento
// da conta com o comprovante da baixa, nem esconder um quando ambos existem.
export function payableAttachmentRecord(record = {}, field = 'document_url') {
  if (!['document_url', 'proof_url', 'storage_path'].includes(field) || !record[field]) return null;
  return {
    id: record.id,
    proof_url: field === 'storage_path' ? '' : record[field],
    storage_path: field === 'storage_path' ? record.storage_path : '',
    file_name: record._attachmentFields?.[field]?.filename || (field === 'storage_path' ? record.file_name : undefined),
    mime_type: record._attachmentFields?.[field]?.mediaType || (field === 'storage_path' ? record.mime_type : undefined),
    file_size: record._attachmentFields?.[field]?.size || (field === 'storage_path' ? record.file_size : undefined),
  };
}

export async function validatePayableAttachmentFile(file) {
  if (!file?.size) throw new Error('O arquivo está vazio.');
  if(file.size>15*1024*1024)throw new Error('O arquivo excede o limite de 15 MiB.');
  const mime=({pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'})[(file.name||'').split('.').at(-1).toLowerCase()];
  if (!PAYMENT_PROOF_TYPES.includes(mime)) {
    throw new Error('Selecione um arquivo JPG, JPEG, PNG, WEBP ou PDF.');
  }
  await validateContent(new Blob([file],{type:mime}));
}
