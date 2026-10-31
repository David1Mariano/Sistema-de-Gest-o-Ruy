import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=workerUrl;

// No PDF scripts, forms or remote links are executed. Originals are never rewritten.
export async function verifiedPdfDocument(bytes){
 const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useWasm:false,useSystemFonts:true,stopAtErrors:true,disableAutoFetch:true});
 try{const doc=await task.promise;if(!doc.numPages||doc.numPages>200)throw Error('PDF excede o limite de 200 páginas para visualização.');return {numPages:doc.numPages,getPage:n=>doc.getPage(n),destroy:()=>task.destroy()};}catch(error){await task.destroy();throw error;}
}
export const pdfPrintHtml=pages=>'<!doctype html><html><head><meta charset="utf-8"><title>Comprovante</title><style>@page{size:A4;margin:0}body{margin:0}.page{width:210mm;height:296mm;display:flex;align-items:center;justify-content:center;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}img{display:block;max-width:100%;max-height:100%;object-fit:contain}</style></head><body>'+pages.map(src=>'<div class="page"><img alt="Página do comprovante" src="'+src+'"></div>').join('')+'</body></html>';

export default forwardRef(function PdfPages({url,onError},ref){
 const container=useRef(null),frames=useRef([]),[ready,setReady]=useState(false);
 useImperativeHandle(ref,()=>({print:async()=>{
  if(!ready)throw Error('Aguarde o carregamento completo do PDF.');
  const pages=[...container.current.querySelectorAll('canvas')].map(canvas=>canvas.toDataURL('image/png'));
  const frame=document.createElement('iframe');frame.title='Impressão do comprovante';frame.style.cssText='position:fixed;width:1px;height:1px;left:-10000px;border:0';document.body.appendChild(frame);frames.current.push(frame);
  frame.contentDocument.open();frame.contentDocument.write(pdfPrintHtml(pages));frame.contentDocument.close();
  await Promise.all([...frame.contentDocument.images].map(img=>img.decode()));frame.contentWindow.focus();frame.contentWindow.print();
 }}),[ready]);
 useEffect(()=>{let cancelled=false,doc;const controller=new AbortController();setReady(false);container.current.replaceChildren();
  void(async()=>{const response=await fetch(url,{signal:controller.signal});const bytes=await response.arrayBuffer();doc=await verifiedPdfDocument(bytes);for(let n=1;n<=doc.numPages&&!cancelled;n++){const page=await doc.getPage(n),viewport=page.getViewport({scale:1.5}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.setAttribute('aria-label','Página '+n+' do PDF');canvas.style.cssText='display:block;max-width:100%;height:auto;margin:12px auto;background:white';if(viewport.width*viewport.height>16000000)throw Error('Dimensões do PDF excedem o limite de visualização.');await page.render({canvasContext:canvas.getContext('2d'),viewport,annotationMode:0}).promise;if(!cancelled)container.current.appendChild(canvas);}if(!cancelled)setReady(true);})().catch(()=>{if(!cancelled)onError?.('Não foi possível decodificar este PDF. O original foi preservado.');});
  return()=>{cancelled=true;controller.abort();void doc?.destroy();for(const frame of frames.current)frame.remove();frames.current=[];};
 },[url]); // onError may be an inline callback; opening a document owns this task.
 return <div ref={container} data-pdf-ready={ready?'true':'false'} aria-label="Páginas do PDF" className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3"/>;
});
