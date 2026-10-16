import {transaction,fail,digest,uuid} from './core.mjs';
import {sectorKey} from '../../src/lib/sectorUtils.js';
import {employeesUsingRole} from '../../src/lib/roleUtils.js';
import {projectEmployee} from './catalog-contract.mjs';
export const record=r=>({...r.data,id:r.id,_version:Number(r.version),created_date:r.created_at,updated_date:r.updated_at});
const projectResult=(value,role)=>({...value,...(value.cascata?{cascata:value.cascata.map(item=>item.entity==='Employee'?{...item,record:projectEmployee(item.record,role)}:item)}:{})});
const entities=['Sector','JobRole','Employee'];
export async function list(pool,user,entity){
 if(!entities.includes(entity))throw fail(403,'Módulo fora da etapa D1.');
 const rows=(await pool.query('SELECT * FROM d1_records WHERE owner_id=$1 AND entity=$2 ORDER BY created_at DESC,id',[user.id,entity])).rows;
 return rows.filter(r=>r.data._deleted!=='true').map(r=>entity==='Employee'?projectEmployee(record(r),user.role):record(r));
}
export async function save(pool,user,deviceId,entity,id,body,hook=async()=>{}){
 if(!['Sector','JobRole'].includes(entity)||!uuid(id)||!uuid(body.operationId)||!['create','update'].includes(body.operation))throw fail(400,'Comando D1 inválido.');
 const {data,baseVersion,operation,operationId}=body;
 if(operation==='create'?baseVersion!=null:!Number.isSafeInteger(baseVersion)||baseVersion<1)throw fail(400,'Versão obrigatória.');
 const fields=entity==='Sector'?['name','description','role_purpose','responsible_name','status']:['name','sector_id','sector_name','status'];
 if(!data||Array.isArray(data)||Object.keys(data).some(k=>!fields.includes(k))||!Object.values(data).every(v=>typeof v==='string'&&v.length<=2000))throw fail(400,'Campos inválidos.');
 if(data.name!==undefined&&(!data.name.trim().startsWith('FICTICIO ')||data.name.length>120))throw fail(400,'Use nome FICTICIO no laboratório.');
 if(data.status!==undefined&&!['ativo','inativo'].includes(data.status))throw fail(400,'Status inválido.');
 // ETAPA D1.1: confirmação explícita de renomeação em cascata. O cliente declara o
 // impacto que exibiu ao usuário; o servidor revalida contra o estado real.
 if(body.confirmRename!==undefined&&typeof body.confirmRename!=='boolean')throw fail(400,'Confirmação de renomeação inválida.');
 if(body.renameImpact!==undefined){
  const i=body.renameImpact;
  if(!i||typeof i!=='object'||Array.isArray(i)||!Number.isSafeInteger(i.colaboradores)||!Number.isSafeInteger(i.funcoes)||i.colaboradores<0||i.funcoes<0)throw fail(400,'Impacto de renomeação inválido.');
 }
 const confirmRename=body.confirmRename===true,declaredImpact=confirmRename?body.renameImpact:undefined;
 const hash=digest(JSON.stringify({entity,id,operation,baseVersion:baseVersion??null,confirmRename,renameImpact:declaredImpact?{colaboradores:declaredImpact.colaboradores,funcoes:declaredImpact.funcoes}:null,data:Object.fromEntries(Object.entries(data).sort())}));
 return transaction(pool,async c=>{
  // Serializa comandos de cadastros por usuário para dependências e duplicidade.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user.id]);
  const actor=(await c.query('SELECT * FROM lab_users WHERE id=$1 AND active FOR SHARE',[user.id])).rows[0];
  if(!actor)throw fail(401,'Sessão revogada.');
  if(!['admin','writer'].includes(actor.role))throw fail(403,'Sem permissão de cadastro.');
  const prior=(await c.query('SELECT * FROM lab_outbox WHERE operation_id=$1',[operationId])).rows[0];
  if(prior){if(prior.actor!==actor.id||prior.payload_hash!==hash)throw fail(409,'Operação reutilizada com outro conteúdo.');return projectResult({...prior.result,replay:true},actor.role);}
  const current=(await c.query('SELECT * FROM d1_records WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(current&&(current.owner_id!==actor.id||current.entity!==entity))throw fail(403,'Registro fora da permissão.');
  if(operation==='create'?!!current:!current||Number(current.version)!==baseVersion)throw fail(409,'Conflito de versão; recarregue sem descartar seu formulário.');
  const merged={...(current?.data||{}),...data};
  if(!merged.name?.trim()||!merged.status)throw fail(400,'Nome e status obrigatórios.');
  if(entity==='JobRole'){
   if(merged.sector_id){
    if(!uuid(merged.sector_id))throw fail(400,'Setor inválido.');
    const sector=(await c.query("SELECT * FROM d1_records WHERE id=$1 AND entity='Sector' AND owner_id=$2",[merged.sector_id,actor.id])).rows[0];
    if(!sector||sector.data.name!==merged.sector_name)throw fail(409,'Setor inexistente ou nome divergente.');
    if(sector.data.status!=='ativo'&&(!current||current.data.sector_id!==sector.id))throw fail(409,'Setor inativo não aceita novo vínculo.');
   }else if(merged.sector_name)throw fail(400,'Nome de setor sem identificador.');
   if(current?.data.status==='ativo'&&merged.status==='inativo'){
    const employees=(await c.query("SELECT data FROM d1_records WHERE entity='Employee' AND owner_id=$1",[actor.id])).rows.map(r=>r.data);
    if(employeesUsingRole(employees,current.data).length)throw fail(409,'Função vinculada a colaboradores; realoque antes de desativar.');
   }
  }
  // ETAPA D1.1 — RENOMEAÇÃO SEGURA DE SETORES.
  // Antes: bloquear renomeação em uso, porque vínculos legados são textuais
  // (JobRole.sector_name e Employee.sector) e renomear sem cascata deixaria os
  // vínculos apontando para um nome que não existe mais.
  //
  // Agora: renomear é permitido SOMENTE com confirmação explícita. O servidor:
  //   1) conta os vínculos reais (JobRole + Employee) ligados ao nome atual;
  //   2) exige confirmRename=true e renameImpact coerente com a contagem real
  //      (protege contra usuário que confirmou um impacto diferente do atual);
  //   3) pré-valida duplicidade de nome equivalente (falha ANTES da cascata);
  //   4) atualiza setor + funções + colaboradores na MESMA transação;
  //   5) registra a operação na auditoria local.
  // Qualquer erro lança dentro de transaction() -> ROLLBACK total.
  let rename=null;
  if(entity==='Sector'&&current&&sectorKey(current.data.name)!==sectorKey(merged.name)){
   const refs=(await c.query("SELECT id,entity,data FROM d1_records WHERE owner_id=$1 AND entity IN ('Employee','JobRole')",[actor.id])).rows;
   const funcs=refs.filter(r=>r.entity==='JobRole'&&(r.data.sector_id===id||sectorKey(r.data.sector_name)===sectorKey(current.data.name)));
   const cols=refs.filter(r=>r.entity==='Employee'&&sectorKey(r.data.sector)===sectorKey(current.data.name));
   const impact={colaboradores:cols.length,funcoes:funcs.length};
   if(impact.colaboradores||impact.funcoes){
    // Ação perigosa sem confirmação continua bloqueada — com a MESMA mensagem de
    // sempre, para não afrouxar nenhum teste ou contrato de erro já verificado.
    if(!declaredImpact)throw fail(409,'Renomeação com vínculos exige regra de atualização aprovada.');
    // O impacto confirmado tem que ser o impacto real AGORA. Se o estado mudou
    // entre o diálogo e o envio, não renomeamos: pedimos nova confirmação.
    if(declaredImpact.colaboradores!==impact.colaboradores||declaredImpact.funcoes!==impact.funcoes)
     throw fail(409,'Impacto confirmado difere dos vínculos atuais; recarregue e confirme novamente.');
    // Duplicidade: proíbe colidir com OUTRO setor de nome equivalente (o índice
    // único do banco protege o dono, mas a mensagem aqui é explícita).
    const dup=(await c.query("SELECT id FROM d1_records WHERE owner_id=$1 AND entity='Sector' AND id<>$2 AND name_key=$3",[actor.id,id,sectorKey(merged.name)])).rows[0];
    if(dup)throw fail(409,'Já existe um setor com esse nome.');
    rename={from:current.data.name,to:merged.name,impact,funcs:funcs.map(r=>r.id),cols:cols.map(r=>r.id)};
   }
  }
  // Renomear FUNÇÃO em uso continua bloqueado (fora do escopo D1.1): o vínculo
  // legado é Employee.function e não há cascata aprovada para esse caso.
  if(entity==='JobRole'&&current&&sectorKey(current.data.name)!==sectorKey(merged.name)){
   const cols=(await c.query("SELECT data FROM d1_records WHERE owner_id=$1 AND entity='Employee'",[actor.id])).rows;
   if(cols.some(r=>sectorKey(r.data.function)===sectorKey(current.data.name)))throw fail(409,'Renomeação com vínculos exige regra de atualização aprovada.');
  }
  const row=operation==='create'?(await c.query('INSERT INTO d1_records(id,owner_id,entity,data,name_key) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,actor.id,entity,merged,sectorKey(merged.name)])).rows[0]:(await c.query('UPDATE d1_records SET data=$2,name_key=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[id,merged,sectorKey(merged.name)])).rows[0];
  // Cascata da renomeação: mesma transação, mesma conexão. Só o CAMPO textual do
  // vínculo muda (JobRole.sector_name, Employee.sector); id, demais campos e
  // identificadores ficam intactos. Cada registro afetado ganha +1 de versão para
  // o cliente não sobrescrever com baseVersion velha depois.
  const cascade=[];
  if(rename){
   for(const rid of rename.funcs){
    const r=(await c.query("UPDATE d1_records SET data=jsonb_set(data,'{sector_name}',to_jsonb($2::text)),version=version+1,updated_at=now() WHERE id=$1 RETURNING *",[rid,rename.to])).rows[0];
    cascade.push({entity:'JobRole',record:record(r)});
   }
   for(const rid of rename.cols){
    const r=(await c.query("UPDATE d1_records SET data=jsonb_set(data,'{sector}',to_jsonb($2::text)),version=version+1,updated_at=now() WHERE id=$1 RETURNING *",[rid,rename.to])).rows[0];
    cascade.push({entity:'Employee',record:record(r)});
   }
  }
  const result={record:record(row),operationId,replay:false,...(rename?{rename:{from:rename.from,to:rename.to,colaboradores:rename.impact.colaboradores,funcoes:rename.impact.funcoes}}:{}),...(cascade.length?{cascata:cascade}:{})};
  await c.query('INSERT INTO lab_outbox(operation_id,device_id,actor,entity,record_id,operation,base_version,record_version,payload_hash,payload,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[operationId,deviceId,actor.id,entity,id,operation,baseVersion??null,row.version,hash,{...merged,...(rename?{__rename:result.rename}:{})},result]);
  await c.query('INSERT INTO lab_audit(actor,action,operation_id) VALUES($1,$2,$3)',[actor.id,entity+':'+operation,operationId]);
  // Rastro específico da renomeação perigosa (D1.1): auditoria local explícita,
  // com o mesmo operationId que amarra outbox + auditoria geral.
  if(rename)await c.query('INSERT INTO lab_audit(actor,action,operation_id) VALUES($1,$2,$3)',[actor.id,'Sector:rename_cascade',operationId]);
  await hook(c);
  return projectResult(result,actor.role);
 });
}
