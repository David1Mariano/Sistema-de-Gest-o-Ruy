window.ruyAdmin.details().then(value=>{document.getElementById('email').textContent='Conta confirmada: '+value.email;}).catch(()=>{document.getElementById('status').textContent='Provisionamento indisponível; preserve os dados e consulte o diagnóstico.';});
document.querySelector('form').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget,fields=new FormData(form),button=form.querySelector('button');
 if(fields.get('password')!==fields.get('confirmation')){document.getElementById('status').textContent='As senhas devem ser iguais.';return;}
 button.disabled=true;
 try{const result=await window.ruyAdmin.provision({password:fields.get('password'),consent:fields.get('consent')==='on'});form.reset();document.getElementById('status').textContent=result.ok?'Administrador autorizado. O aplicativo continuará a inicialização.':result.error;}catch{document.getElementById('status').textContent='Não foi possível concluir. Nenhum segredo foi registrado.';}finally{button.disabled=false;}
});
