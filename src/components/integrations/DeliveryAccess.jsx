import { useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requestDeliveryOtp, verifyDeliveryOtp, closeDeliverySession, getDeliverySession, subscribeDeliverySession } from '@/lib/integrations/deliveryClient';

export function useDeliverySession() { return useSyncExternalStore(subscribeDeliverySession, getDeliverySession, () => null); }
export default function DeliveryAccess() {
  const session = useDeliverySession();
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [sent, setSent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async fn => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
    <p className="text-sm font-medium">Acesso verificado às integrações</p>
    {session ? <Button variant="outline" disabled={busy} onClick={() => run(closeDeliverySession)}>Encerrar acesso às integrações</Button> : <>
      <p className="text-xs text-slate-600">Use o e-mail autorizado da empresa. A senha do restaurante nas plataformas não é solicitada.</p>
      <Input aria-label="E-mail autorizado" type="email" value={email} onChange={e => { setEmail(e.target.value); setSent(false); }} placeholder="E-mail autorizado" />
      <Button variant="outline" disabled={busy || !email} onClick={() => run(async () => { await requestDeliveryOtp(email); setSent(true); })}>{busy ? 'Aguarde...' : 'Enviar código de acesso'}</Button>
      {sent && <><Input aria-label="Código recebido por e-mail" inputMode="numeric" value={code} onChange={e => setCode(e.target.value)} placeholder="Código recebido por e-mail" /><Button disabled={busy || !code} onClick={() => run(async () => { await verifyDeliveryOtp(email, code); setCode(''); })}>Verificar acesso</Button></>}
    </>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}
