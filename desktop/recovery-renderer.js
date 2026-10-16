const restore=new URLSearchParams(location.search).get('mode')==='restore';
document.querySelector('#title').textContent=restore?'Validar restauração externa':'Exportar chave protegida';
document.querySelector('#confirmation').hidden=restore;
document.querySelector('input[name=confirmation]').required=!restore;
document.querySelector('form').onsubmit=async event=>{
 event.preventDefault();const form=event.currentTarget,status=document.querySelector('#status'),button=form.querySelector('button');
 const phrase=form.elements.passphrase.value;
 if(!restore&&phrase!==form.elements.confirmation.value){status.textContent='As frases não conferem.';return;}
 button.disabled=true;status.textContent='Validando operação de laboratório...';
 try{const result=await window.labRecovery.submit(phrase);status.textContent=result.ok?'Operação validada.':result.error;}
 catch{status.textContent='Operação não concluída; nenhum banco ativo foi substituído.';}
 finally{button.disabled=false;form.reset();}
};
