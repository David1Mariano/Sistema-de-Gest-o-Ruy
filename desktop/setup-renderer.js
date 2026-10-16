const status=document.querySelector('#status'),create=document.querySelector('#create');
document.querySelector('#postgres').onclick=async()=>{
 const selected=await window.labSetup.choosePostgres();if(selected)document.querySelector('#bin').textContent=selected;
};
document.querySelector('#setup').onsubmit=async event=>{
 event.preventDefault();create.disabled=true;status.textContent='Preparando laboratório local. Aguarde...';
 const form=new FormData(event.currentTarget);
 try{
  const result=await window.labSetup.create({login:form.get('login'),password:form.get('password')});
  status.textContent=result.ok?'Laboratório preparado. Abrindo aplicativo...':result.error;
 }catch{status.textContent='Não foi possível preparar o laboratório. Nenhum dado existente foi apagado.';}
 finally{create.disabled=false;document.querySelector('input[name=password]').value='';}
};
