import {useEffect,useState} from 'react';
import {request} from './client.mjs';
import {historicalMoney} from './historical-detail.mjs';
const names={FinancialExpense:'Despesas',EmployeePayment:'Pagamentos de colaboradores',AccountsPayable:'Contas a pagar',Vale:'Vales',Consumption:'Consumos de RH',FechamentoCaixa:'Fechamentos de caixa'};
const fields={amount:'Valor original',gross_amount:'Bruto original',discount_amount:'Descontos originais',net_amount:'Líquido original',opening_fund:'Abertura histórica',counted_cash:'Caixa contado na origem',expected_cash:'Caixa esperado na origem',difference:'Diferença histórica'};
export default function HistoricalFinance(){
 const [data,setData]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;request('/history/financial-summary').then(v=>{if(active)setData(v);}).catch(()=>{if(active)setError('Não foi possível concluir a consulta financeira histórica. Nenhum saldo foi presumido.');});return()=>{active=false;};},[]);
 return <section className="mx-auto max-w-6xl space-y-4 p-4" aria-label="Financeiro histórico somente leitura">
  <header><h1 className="text-2xl font-semibold">Financeiro — valores históricos</h1><p>Todos os períodos recuperados · Somente consulta · Sem pagamentos ou lançamentos.</p></header>
  <div className="rounded border border-amber-500 p-3" role="status"><p>Saldo atual de caixa: <strong>Não confirmado</strong></p><p>Saldo atual dos bancos: <strong>Não confirmado</strong></p><p>As somas abaixo são de documentos históricos e não representam saldo disponível.</p></div>
  {error&&<p role="alert">{error}</p>}
  {!data&&!error&&<p>Consultando documentos históricos…</p>}
  {data&&<><p>{data.records} documentos consultados, agrupados por entidade e situação original.</p><p>{data.notice}</p>
   <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Documentos</th><th>Situação original</th><th>Quantidade</th><th>Campo original</th><th>Total histórico</th><th>Conferência</th></tr></thead><tbody>{data.groups.flatMap(g=>g.values.map(v=><tr key={g.entity+'|'+g.status+'|'+v.field} className="border-t"><td><a className="underline" href={'/historico?entity='+g.entity}>{names[g.entity]||g.entity}</a></td><td>{g.status??'Não informado'}</td><td>{g.records}</td><td>{fields[v.field]||v.field}</td><td>{historicalMoney(v.cents)}</td><td>{v.invalid?`${v.invalid} valor(es) inválido(s) preservado(s)`:v.missing?`${v.missing} campo(s) não informado(s)`:'Campos informados'}</td></tr>))}</tbody></table></div>
   <p role="note">Não some pagamentos de colaboradores às despesas correspondentes: podem representar o mesmo desembolso. Os {data.pendingVales} vales pendentes não geram descontos. Fechamentos históricos não aprovam saldos de abertura.</p>
  </>}
 </section>;
}
