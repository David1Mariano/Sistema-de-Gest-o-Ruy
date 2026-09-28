import AttachmentPreview from './AttachmentPreview';
import { PAYMENT_PROOF_DIAG, PAYMENT_PROOF_PREFIX } from '@/lib/paymentProof';

// EmployeePayment passa a usar o visualizador genérico. Mantido como wrapper
// para não alterar as telas de pagamento.
export default function PaymentProof({ payment = {}, label = 'Ver comprovante' }) {
  return (
    <AttachmentPreview
      record={payment}
      label={label}
      title={payment.file_name || 'Comprovante de pagamento'}
      prefix={PAYMENT_PROOF_PREFIX}
      diagLabel={PAYMENT_PROOF_DIAG}
    />
  );
}

