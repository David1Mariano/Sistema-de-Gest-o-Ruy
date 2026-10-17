import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toCents } from '@/lib/delivery/money';
import { CHANNELS, validateOrder, totalsOf } from '@/lib/delivery/deliveryRules';

const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

export function NovoPedidoDialog({ open, onClose, onSaved }) {
  const [cliente, setCliente] = useState('');
  const [canal, setCanal] = useState('whatsapp');
  const [item, setItem] = useState('Caldo de cana 500ml');
  const [qtd, setQtd] = useState('2');
  const [preco, setPreco] = useState('8,00');
  const [erro, setErro] = useState('');
  const salvar = () => {
    try {
      const cents = toCents(preco);
      const items = [{ product_name: item, qty: Number(qtd), unit_price_cents: cents }];
      validateOrder({ customer_name: cliente, items, channel: canal, fulfillment: 'entrega' });
      const t = totalsOf({ items, channel: canal, delivery_fee_cents: 500 });
      onSaved({ id: `lab${Date.now().toString(36)}`, created_date: new Date().toISOString(), customer_name: cliente, channel: canal, fulfillment: 'entrega', status: 'novo', payment_method: 'pix', items, ...t });
    } catch (e) { setErro(e.message); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Novo pedido (laboratório)</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">Cliente<input className={inputCls} value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Nome" /></label>
          <label className="text-xs">Canal<select className={inputCls} value={canal} onChange={(e) => setCanal(e.target.value)}>{Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-xs">Item<input className={inputCls} value={item} onChange={(e) => setItem(e.target.value)} /></label>
          <label className="text-xs">Qtd<input className={inputCls} value={qtd} onChange={(e) => setQtd(e.target.value)} /></label>
          <label className="text-xs sm:col-span-2">Preço unit. (R$)<input className={inputCls} value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="8,00" /></label>
        </div>
        {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={salvar}>Salvar pedido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
