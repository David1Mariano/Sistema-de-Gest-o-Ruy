import {useState} from 'react';
import {request} from './client.mjs';
export default function AccountAccess({adopt}){
 const [mode,setMode]=useState('login'),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const modes={login:'Entrar',register:'Criar conta',verify:'Confirmar e-mail',resend:'Reenviar código','reset-request':'Recuperar senha',reset:'Redefinir senha'};
 return <section className="mx-auto mt-8 max-w-md space-y-4 rounded-xl border bg-card p-6">
  <h1 className="text-xl font-semibold">Sistema Ruy — acesso individual</h1><p>Ambiente isolado de desenvolvimento. Confirmação de e-mail e aprovação administrativa são obrigatórias.</p>
  <form className="space-y-3" onSubmit={async e=>{e.preventDefault();setBusy(true);setMessage('');const form=e.currentTarget,f=new FormData(form);try{
   const data=Object.fromEntries(f);if(mode==='login')adopt(await request('/login',{login:data.email,password:data.password}));
   else{await request('/account/'+mode,data);form.reset();setMessage(mode==='verify'?'E-mail confirmado. Aguarde aprovação do administrador.':'Solicitação recebida. Verifique seu e-mail quando o envio estiver configurado. Nenhum código será mostrado aqui.');}
  }catch(err){setMessage(err.message);}finally{setBusy(false);}}}>
   {mode==='register'&&<label className="block">Nome<input className="block w-full border bg-background p-2" name="name" minLength={2} maxLength={120} required autoComplete="name"/></label>}
   <label className="block">E-mail<input className="block w-full border bg-background p-2" name="email" type="email" maxLength={254} required autoComplete="username"/></label>
   {['login','register','reset'].includes(mode)&&<label className="block">{mode==='reset'?'Nova senha':'Senha individual'}<input className="block w-full border bg-background p-2" name="password" type="password" minLength={mode==='login'?1:15} maxLength={256} required autoComplete={mode==='login'?'current-password':'new-password'}/></label>}
   {['verify','reset'].includes(mode)&&<label className="block">Código recebido por e-mail<input className="block w-full border bg-background p-2" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code"/></label>}
   <button type="submit" disabled={busy} className="rounded bg-amber-500 px-4 py-2 text-black">{busy?'Aguarde…':modes[mode]}</button>
  </form>
  {message&&<p role="status">{message}</p>}
  <nav aria-label="Opções de acesso" className="flex flex-wrap gap-3">{Object.entries(modes).filter(([key])=>key!==mode).map(([key,title])=><button type="button" className="underline" disabled={busy} key={key} onClick={()=>{setMode(key);setMessage('');}}>{title}</button>)}</nav>
 </section>;
}
