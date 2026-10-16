import {Children,cloneElement,isValidElement,forwardRef,useEffect,useState} from 'react';
import {DialogContent as OfficialContent} from '../../src/components/ui/dialog.jsx';
export {Dialog,DialogPortal,DialogOverlay,DialogTrigger,DialogClose,DialogHeader,DialogFooter,DialogTitle,DialogDescription} from '../../src/components/ui/dialog.jsx';
// Somente build D1: exibe os erros dentro do portal, acima do overlay.
export const DialogContent=forwardRef(function D1DialogContent({children,style,...props},ref){
 const [error,setError]=useState('');
 // Captura também falhas do próprio formulário, antes de chegar ao adaptador.
 const protect=nodes=>Children.map(nodes,node=>{
  if(!isValidElement(node))return node;
  const next={};
  if(node.props.children)next.children=protect(node.props.children);
  if(typeof node.props.onClick==='function')next.onClick=async(...args)=>{
   setError('');
   try{return await node.props.onClick(...args);}catch(failure){setError(failure?.message||'Não foi possível salvar. Tente novamente sem fechar o formulário.');}
  };
  return cloneElement(node,next);
 });
 useEffect(()=>{const failed=e=>setError(e.detail),saved=()=>setError('');window.addEventListener('d1-error',failed);window.addEventListener('d1-changed',saved);return()=>{window.removeEventListener('d1-error',failed);window.removeEventListener('d1-changed',saved);};},[]);
 return <OfficialContent ref={ref} {...props} style={{...style,maxHeight:'calc(100dvh - 32px)',overflowY:'auto',overscrollBehavior:'contain'}} className={`${props.className||''} max-h-[90dvh] overflow-y-auto`}>
  {error&&<p role="alert" aria-live="assertive" className="rounded border border-red-500 bg-red-100 p-3 text-sm text-red-950">{error}</p>}
  {protect(children)}
  <p className="text-xs text-muted-foreground">Laboratório: o nome deve começar por FICTICIO (ex.: FICTICIO Setor teste). Renomear um setor com vínculos exige confirmação do impacto e atualiza as referências na mesma transação.</p>
 </OfficialContent>;
});
