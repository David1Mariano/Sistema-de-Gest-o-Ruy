import {isDomain,domainFields,readOnlyDomains} from '../../server/d1-lab/domain-contract.mjs';
export {isDomain};
export function createDomainAdapter({request,getSession,signal,committed=()=>{}}){
 const cache=new Map();
 const emit=()=>globalThis.dispatchEvent(new Event('d1-changed'));
 const clean=(entity,data)=>Object.fromEntries(Object.entries(data).filter(([key])=>domainFields[entity]?.includes(key)));
 async function command(entity,id,data,action='save',extra={}){
  const user=getSession()?.user;
  if(user?.role!=='admin')return signal(Error('Domínio exige administrador local.'));
  if(readOnlyDomains.includes(entity))return signal(Error('Esta escrita ainda aguarda integração atômica e homologação.'));
  const key='ruy-d1-domain:'+user.id+':'+entity+':'+(id||'new')+':'+action;
  const input={entity,id:id||null,action,data:clean(entity,data||{}),...extra};
  const fingerprint=JSON.stringify(input),prior=JSON.parse(localStorage.getItem(key)||'null');
  if(prior&&prior.fingerprint!==fingerprint)return signal(Error('Há tentativa sem confirmação. Reenvie os mesmos campos antes de editar.'));
  const body=prior?.body||{...input,id:id||crypto.randomUUID(),operationId:crypto.randomUUID(),baseVersion:id?(data?._version??cache.get(entity+':'+id)?._version):null};
  if(id&&!body.baseVersion)return signal(Error('Recarregue o documento antes de alterar.'));
  localStorage.setItem(key,JSON.stringify({fingerprint,body}));
  try{
   const result=await request('/domain/command',body);
   cache.set(entity+':'+body.id,result.domainRecord);localStorage.removeItem(key);committed(result);emit();return result.domainRecord;
  }catch(e){if(!e.d1SessionChanged&&e.status>=400&&e.status<500&&![408,429].includes(e.status))localStorage.removeItem(key);return signal(e);}
 }
 function entity(entity){return {
  async list(sort='-created_date',limit=1000){
   if(entity==='RecipeIngredient')return (await this.products()).flatMap(p=>p.ingredients||[]);
   if(!/^-?[a-z_]+$/.test(sort)||!Number.isSafeInteger(limit)||limit<1)throw Error('Ordenação/limite inválidos.');
   const {records}=await request('/domain/'+entity);for(const row of records)cache.set(entity+':'+row.id,row);
   const key=sort.replace(/^-/,'');return records.sort((a,b)=>String(a[key]??'').localeCompare(String(b[key]??''),'pt-BR',{numeric:true})*(sort.startsWith('-')?-1:1)).slice(0,limit);
  },
  products:()=>entityClient('ProductionProduct').list('name',1000),
  async filter(query,sort='-created_date',limit=1000){return (await this.list(sort,100000)).filter(r=>Object.entries(query).every(([k,v])=>r[k]===v)).slice(0,limit);},
  async get(id){return (await this.list('-created_date',100000)).find(r=>r.id===id)||null;},
  create:data=>command(entity,null,data),update:(id,data)=>command(entity,id,data),
  delete:id=>command(entity,id,{},'cancel'),
  subscribe(fn){globalThis.addEventListener('d1-changed',fn);return()=>globalThis.removeEventListener('d1-changed',fn);},
 };}
 const entityClient=entity;
 return {entity,clear:()=>cache.clear(),command,
  recipe:(product,ingredients)=>command('ProductionProduct',product.id||null,{...product,ingredients:ingredients.map(line=>({...line,quantity:Number(line.quantity)}))}),
  preview:id=>request('/domain/preview/'+id),
  confirm:(record,token)=>command('DailyProduction',record.id,record,'confirm',{token}),
  payment:(data,editing)=>command('EmployeePayment',editing?.id||null,{...data,_version:editing?._version}),
  settle:(payable,data)=>command('AccountsPayable',payable.id,{...payable,...data,status:'pago',_version:payable._version}),
  receive:record=>command('AccountsReceivable',record.id,{...record,status:'recebido',received_date:new Date().toLocaleDateString('en-CA'),_version:record._version}),
  generate:record=>command('RecurringExpense',record.id,record,'generate'),
  entry:(type,form,account)=>{
   const entity={receita:'Revenue',receber:'AccountsReceivable',cartao:'CardReceivable',delivery:'DeliverySettlement',conciliacao:'ManualReconciliation'}[type];
   if(!entity)return signal(Error('Tipo de lançamento não habilitado.'));
   const data=clean(entity,form);
   for(const key of Object.keys(data))if(/amount$/.test(key)||key==='orders_count')data[key]=Number(data[key]||0);
   const fees=type==='delivery'?['discount_amount','commission_amount','delivery_fee_amount','other_fee_amount'].reduce((s,k)=>s+Number(data[k]||0),0):Number(data.fee_amount||0);
   if(['receita','receber','cartao','delivery'].includes(type))data.net_amount=form.net_amount?Number(form.net_amount):Math.round((Number(data.gross_amount||0)-fees)*100)/100;
   data.financial_account_name=account?.name||'';data.status=type==='receita'?'recebido':'pendente';
   if(['receita','receber'].includes(type))data.description=form.description||(type==='receita'?'Receita manual':'Conta a receber');
   return command(entity,null,data);
  },
 };
}
