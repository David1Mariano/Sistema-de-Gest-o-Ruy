// Envio REAL do código de confirmação por e-mail, via Web3Forms
// (https://web3forms.com — plano gratuito).
//
// A access key abaixo foi fornecida pelo próprio dono do projeto.
// Observação sobre o Web3Forms: no plano gratuito, a entrega do e-mail
// acontece na caixa de entrada associada à access key (o e-mail de quem
// criou a conta no Web3Forms). O campo `to`/`replyto` é preenchido com o
// e-mail de quem se cadastrou, para que a resposta caia nele também.
//
// Enquanto a chave estiver vazia, o app NÃO quebra: ele entrega o código
// em modo demonstração (exibido na própria tela de verificação).

const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';

export const emailConfig = {
  // Pode ser sobrescrito por VITE_WEB3FORMS_ACCESS_KEY no .env.local
  accessKey: import.meta.env.VITE_WEB3FORMS_ACCESS_KEY || '227847c4-c908-41d7-a50d-34926f5d2477',
};

export function isEmailConfigured() {
  return Boolean(emailConfig.accessKey);
}

/**
 * Envia o código de verificação para `toEmail`.
 * @param {string} toEmail e-mail do cadastro
 * @param {string} code código de 6 dígitos
 * @returns {Promise<{delivered: boolean}>} delivered=true só se o e-mail
 *          foi aceito pelo serviço de envio.
 */
export async function sendVerificationCode(toEmail, code) {
  if (!isEmailConfigured()) {
    return { delivered: false };
  }

  const payload = {
    access_key: emailConfig.accessKey,
    subject: 'Código de confirmação - Sistema de Gestão Ruy',
    from_name: 'Sistema de Gestão Ruy',
    from_email: toEmail,
    replyto: toEmail,
    to: toEmail,
    botcheck: false,
    message:
      `Você recebeu este e-mail porque fez o cadastro no Sistema de Gestão Ruy.\n\n` +
      `Código de confirmação: ${code}\n\n` +
      `E-mail do cadastro: ${toEmail}\n` +
      `O código expira em 10 minutos.`,
  };

  const response = await fetch(WEB3FORMS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    // resposta não-JSON: tratada abaixo pelo status
  }

  if (!response.ok || !data?.success) {
    const detail = data?.message || `HTTP ${response.status}`;
    throw new Error(`Falha ao enviar o e-mail: ${detail}`);
  }

  return { delivered: true };
}
