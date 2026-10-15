import {useEffect,useState} from 'react';
import {localDomain} from './client.mjs';
import {Button} from '@/components/ui/button';
export default function ConsumptionControls({record,onConfirmed}){
 const [preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;setPreview(null);setError('');localDomain.preview(record.id).then(p=>{if(active)setPreview(p);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[record.id,record._version]);
 const confirm=async()=>{setBusy(true);setError('');try{await localDomain.confirm(record,preview.token);setPreview({...preview,alreadyConfirmed:true,canConfirm:false});onConfirmed?.();}catch(e){setError(e.message);setPreview(null);}finally{setBusy(false);}};
 return <section className="space-y-3 rounded-lg border p-3" aria-label="Baixa local de insumos">
  <p>Consumo calculado sobre a quantidade produzida total, incluindo as perdas informadas dentro desse total. Sobras não geram nova baixa. A confirmação movimenta somente insumos locais; entrega ao C2 permanece provisória.</p>
  {preview&&<><table className="w-full text-sm"><thead><tr><th>Insumo</th><th>Consumo confirmado na prévia</th><th>Disponível</th></tr></thead><tbody>{preview.inputs.map(i=><tr key={i.itemId}><td>{i.itemName}</td><td>{i.quantityMilli/1000} {i.unit}</td><td>{i.availableMilli/1000} {i.unit}</td></tr>)}</tbody></table><Button disabled={busy||!preview.canConfirm||preview.alreadyConfirmed} onClick={confirm}>{preview.alreadyConfirmed?'Baixa local já confirmada':busy?'Confirmando...':'Confirmar baixa local no estoque'}</Button></>}
  {error&&<p role="alert">{error} Feche e reabra a conferência para recarregar.</p>}
 </section>;
}
