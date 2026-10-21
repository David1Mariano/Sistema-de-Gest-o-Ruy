import {useEffect,useState} from 'react';
import {request} from './client.mjs';

const labels={Employee:'Colaboradores',Sector:'Setores',JobRole:'Funções',FinancialExpense:'Despesas',EmployeePayment:'Pagamentos',Vale:'Vales',Consumption:'Consumos de RH',Absence:'Ausências',Warning:'Advertências',InventoryItem:'Estoque',StockMovement:'Movimentações',ExpenseCategory:'Categorias',AccountsPayable:'Contas a pagar',FechamentoCaixa:'Fechamentos de caixa',AuditLog:'Auditoria restrita'};
const fieldLabels={amount:'Valor original',net_amount:'Valor líquido original',gross_amount:'Valor bruto original',current_stock:'Quantidade registrada',quantity:'Quantidade'};
export default function History(){
 const [access,setAccess]=useState(null),[entity,setEntity]=useState(''),[search,setSearch]=useState(''),[status,setStatus]=useState(''),[offset,setOffset]=useState(0),[page,setPage]=useState(null),[totals,setTotals]=useState([]),[detail,setDetail]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;request('/history/status').then(v=>{if(active){setAccess(v);setEntity(v.entities[0]?.entity||'');}}).catch(()=>{if(active)setError('Histórico indisponível ou acesso não autorizado.');});return()=>{active=false;};},[]);
 useEffect(()=>{if(!entity)return;let active=true;setPage(null);setDetail(null);setError('');const query=new URLSearchParams({entity,search,status,offset:String(offset)});
  Promise.all([request('/history/records?'+query),request('/history/totals?'+new URLSearchParams({entity}))]).then(([p,t])=>{if(active){setPage(p);setTotals(t.totals);}}).catch(()=>{if(active)setError('Consulta histórica não concluída. Nenhum registro foi alterado.');});return()=>{active=false;};},[entity,search,status,offset]);
 const open=async id=>{setDetail(null);try{setDetail(await request('/history/records/'+id));}catch{setError('Registro indisponível ou consulta não autorizada.');}};
 const choose=e=>{setEntity(e.target.value);setOffset(0);setDetail(null);};
 return <section className="mx-auto max-w-6xl space-y-4 p-4" aria-label="Histórico Recuperado — Supabase">
  <h1 className="text-2xl font-semibold">Histórico Recuperado — Supabase</h1>
  <p role="status" className="rounded border border-amber-500 p-3">Dados históricos reais · Somente leitura · Sem pagamentos, estornos, movimentações ou sincronização.</p>
  <p className="text-sm">IDs, estados, datas e valores preservados da origem. Somas de campos não equivalem a saldos conciliados. Objetos sem vínculo confirmado permanecem em quarentena.</p>
  {error&&<p role="alert">{error}</p>}
  {access&&<>
   <div className="flex flex-wrap gap-3">
    <label>Entidade<select aria-label="Entidade histórica" value={entity} onChange={choose} className="block rounded border bg-background p-2">{access.entities.map(e=><option key={e.entity} value={e.entity}>{labels[e.entity]||e.entity} ({e.total})</option>)}</select></label>
    <label>Pesquisar<input aria-label="Pesquisa histórica" value={search} maxLength={120} onChange={e=>{setSearch(e.target.value);setOffset(0);}} className="block rounded border bg-background p-2"/></label>
    <label>Estado original<input aria-label="Estado histórico" value={status} maxLength={60} onChange={e=>{setStatus(e.target.value);setOffset(0);}} className="block rounded border bg-background p-2"/></label>
   </div>
   {page&&<><p aria-label="Quantidade histórica">{page.total} registro(s) nesta consulta</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Registro</th><th>ID legado</th><th>Data original</th><th>Estado</th><th>Valor original</th><th>Consulta</th></tr></thead><tbody>{page.records.map(r=><tr key={r.id} className="border-t"><td>{r.label}</td><td>{r.legacy_id}</td><td>{r.original_date||r.original_created_date}</td><td>{r.status||'Não informado'}</td><td>{r.amount??r.net_amount??'—'}</td><td><button className="underline p-2" onClick={()=>open(r.id)}>Consultar</button></td></tr>)}</tbody></table></div>
    <div className="flex gap-4"><button disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-30))}>Página anterior</button><button disabled={offset+30>=page.total} onClick={()=>setOffset(offset+30)}>Próxima página</button></div></>}
   {totals.length>0&&<details><summary>Conferência dos valores originais por estado</summary><p>Referência da entidade inteira, sem recalcular documentos. Quantidades de unidades distintas não representam um saldo operacional.</p><ul>{totals.map((t,i)=><li key={i}>{fieldLabels[t.field]||t.field} · {t.status??'Sem estado'}: {t.total} ({t.count} registros)</li>)}</ul></details>}
  </>}
  {detail&&<article className="space-y-3 rounded border p-4" aria-label="Registro histórico consultado">
   <h2 className="font-semibold">{labels[detail.record.entity]||detail.record.entity} — {detail.record.legacy_id}</h2>
   <p>ID de consulta: {detail.record.id}</p><p>Criado na origem: {detail.record.original_created_date} · Atualizado na origem: {detail.record.original_updated_date}</p>
   {detail.exceptions.length>0&&<div role="note" className="border border-amber-500 p-3">Inconsistência histórica preservada: referência de origem não localizada. Nenhum registro foi criado para conciliá-la.{detail.exceptions.map((e,i)=><p key={i}>{e.field} → {e.target_entity}: {e.target_legacy_id}</p>)}</div>}
   <h3>Ficha recuperada</h3><dl className="grid gap-2 sm:grid-cols-2" aria-label="Campos históricos originais">{(detail.record.fields||[]).map(f=><div className="rounded border p-2" key={f.name}><dt className="font-semibold">{({name:'Nome',full_name:'Nome completo',employee_name:'Colaborador',employee_id:'Referência do colaborador',sector:'Setor',function:'Função',status:'Situação original',date:'Data',amount:'Valor original',net_amount:'Valor líquido original',gross_amount:'Valor bruto original',discount_amount:'Descontos originais',payment_date:'Data do pagamento',payment_method:'Forma de pagamento',description:'Descrição',observation:'Observação',current_stock:'Saldo registrado',quantity:'Quantidade',cpf:'CPF',phone:'Telefone',email:'E-mail'})[f.name]||f.name}</dt><dd className="whitespace-pre-wrap break-words">{f.value??'Não informado'}</dd></div>)}</dl>
   <details><summary>Registro original para conferência</summary><pre className="whitespace-pre-wrap break-words text-sm">{detail.record.data_text}</pre></details>
   <h3>Registros relacionados autorizados</h3>{detail.related.map(r=><p key={r.id}><button className="underline" onClick={()=>open(r.id)}>{labels[r.entity]||r.entity} · {r.legacy_id} · {r.original_date} · {r.status}</button></p>)}
   <h3>Anexos e comprovantes autorizados</h3>{detail.attachments.length===0?<p>Nenhum anexo disponível para esta consulta.</p>:detail.attachments.map(f=><div key={f.id} className="border-t py-2"><p>{f.original_path} · {f.bytes} bytes</p><p className="break-all text-xs">SHA-256: {f.sha256}</p><a className="underline" href={'/api/d1/history/attachments/'+f.id+'/download'}>Consultar / baixar comprovante</a></div>)}
  </article>}
 </section>;
}
