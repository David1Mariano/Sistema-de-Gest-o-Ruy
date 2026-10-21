import {useEffect,useState} from 'react';
import {request} from './client.mjs';
export default function AccountAdministration(){
 const [users,setUsers]=useState([]),[message,setMessage]=useState('');
 const refresh=()=>request('/account/users').then(v=>setUsers(v.users)).catch(e=>setMessage(e.message));
 useEffect(()=>{refresh();},[]);
 return <section className="space-y-4"><h1 className="text-2xl font-semibold">Acessos individuais</h1><p>Somente contas com e-mail confirmado podem ser autorizadas. Cada alteração revoga as sessões da conta e é auditada.</p>{message&&<p role="status">{message}</p>}
  {users.map(u=><form key={u.id} className="rounded border p-3 space-x-3" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await request('/account/authorize',{userId:u.id,role:f.get('role'),active:f.get('active')==='on'});setMessage('Permissão registrada.');await refresh();}catch(err){setMessage(err.message);}}}>
   <span>{u.full_name} · {u.login} · {u.verified_at?'E-mail confirmado':'E-mail pendente'}</span><select name="role" defaultValue={u.role} aria-label={'Permissão de '+u.full_name}><option value="viewer">Consulta</option><option value="writer">Operação</option><option value="admin">Administração</option></select><label><input name="active" type="checkbox" defaultChecked={u.active}/>Acesso ativo</label><button disabled={!u.verified_at}>Registrar permissão</button>
  </form>)}
  <form className="space-y-2 border p-3" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await request('/account/change-password',{currentPassword:f.get('currentPassword'),password:f.get('password')});window.location.reload();}catch(err){setMessage(err.message);}}}><h2>Alterar minha senha</h2><input aria-label="Senha atual" name="currentPassword" type="password" autoComplete="current-password" required/><input aria-label="Nova senha" name="password" type="password" minLength={15} autoComplete="new-password" required/><button>Alterar senha e encerrar sessões</button></form>
 </section>;
}
