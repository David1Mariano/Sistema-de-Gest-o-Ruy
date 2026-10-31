import {useEffect,useState} from 'react';
import {base44} from '@/api/base44Client';
import {useAuth} from '@/lib/AuthContext';
import AttachmentPreview from './AttachmentPreview';
const labels={Employee:'Colaborador',EmployeePayment:'Pagamento',Vale:'Vale',FinancialExpense:'Despesa',AccountsPayable:'Conta a pagar'};
export default function CentralRecordAttachments({recordId}){
 const {user,sharedMode=false}=useAuth(),transport=base44.localDomain?.attachments;
 const [files,setFiles]=useState([]),[error,setError]=useState('');
 useEffect(()=>{if(!sharedMode||!recordId||!transport)return;let active=true;setFiles([]);setError('');const load=()=>transport.related(recordId).then(rows=>{if(active){setFiles(rows);setError('');}}).catch(()=>{if(active)setError('Não foi possível consultar os comprovantes desta ficha. Verifique a conexão e suas permissões.');});void load();window.addEventListener('d1-changed',load);return()=>{active=false;window.removeEventListener('d1-changed',load);};},[recordId,sharedMode,user?.id,transport]);
 if(!sharedMode||!transport)return null;
 return <section aria-label="Comprovantes desta ficha" className="space-y-2 rounded border p-3"><h2 className="font-semibold">Comprovantes desta ficha</h2>{error&&<p role="alert">{error}</p>}{files.map(f=>{const name=f.filename?.split(/[\\/]/).pop()||'Comprovante',url=f.url||'/api/d1/attachments/'+f.id+'/download';return <div className="rounded border p-2" key={f.id} data-record-attachment={f.id}><p>{name} · {labels[f.entity]||f.entity} · {f.legacyId||f.recordId}</p><p className="text-xs">{f.historical?'Vínculo histórico confirmado, sem efeitos financeiros':'Confirmado na central'}</p><AttachmentPreview record={{id:f.id,proof_url:location.origin+url,file_name:name}} label="Visualizar comprovante"/><a href={url} className="ml-4 underline">Baixar</a></div>;})}{!files.length&&!error&&<p className="text-sm">Nenhum comprovante autorizado nesta ficha ou nos pagamentos históricos vinculados.</p>}</section>;
}
