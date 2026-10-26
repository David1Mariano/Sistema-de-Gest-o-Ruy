import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {useUserRole} from '@/lib/useUserRole';
export default function ReportPDFButton({kind,filters,expectedRows,disabled=false,children}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const {isAdmin}=useUserRole();
 if(!globalThis.ruyReports||!isAdmin)return null;
 return <div><Button variant="outline" disabled={disabled||busy} onClick={async()=>{
  setBusy(true);setMessage('');
  try{const result=await globalThis.ruyReports.save({kind,filters,expectedRows});setMessage(result.saved?'PDF salvo com sucesso.':result.cancelled?'Exportação cancelada.':result.error||'Falha ao exportar PDF.');}
  catch{setMessage('Não foi possível exportar o PDF. Tente novamente.');}finally{setBusy(false);}
 }}>{busy?'Exportando…':children}</Button>{message&&<p role="status" className="text-sm mt-1">{message}</p>}</div>;
}
