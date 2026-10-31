// Reassemble original UTF-8 bytes, including large audit values, without
// truncation or exceeding the Electron main-process per-response limit.
export async function loadHistoricalDetail(id,request){
 const value=await request('/history/records/'+id),original=value.original;
 if(!original)return value; // Existing local historical reader remains valid.
 if(!Number.isSafeInteger(original.bytes)||original.bytes<=0||original.bytes>64*1024*1024||!Number.isSafeInteger(original.chunkSize)||original.chunkSize<1||!/^[a-f0-9]{64}$/.test(original.sha256))throw Error('Metadados históricos inválidos.');
 const bytes=new Uint8Array(original.bytes);let offset=0;
 while(offset<bytes.length){
  const block=await request('/history/records/'+id+'/chunks?offset='+offset);
  if(block.id!==id||block.offset!==offset||block.totalBytes!==bytes.length||block.sha256!==original.sha256||typeof block.bytes!=='string')throw Error('Bloco histórico divergente.');
  const binary=atob(block.bytes),part=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(!part.length||part.length!==block.length||part.length>original.chunkSize||offset+part.length>bytes.length)throw Error('Tamanho histórico divergente.');
  bytes.set(part,offset);offset+=part.length;
 }
 const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
 if(actual!==original.sha256)throw Error('Integridade do registro histórico recusada.');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),raw=JSON.parse(text);
 if(raw.entity!==value.record.entity||raw.id!==value.record.legacy_id||!raw.data||typeof raw.data!=='object')throw Error('Identidade histórica divergente.');
 return {...value,originalVerified:true,originalText:text,record:{...value.record,data_text:JSON.stringify(raw.data,null,2),fields:Object.entries(raw.data).map(([name,v])=>({name,value:v===null?null:typeof v==='string'?v:JSON.stringify(v)}))}};
}
export function historicalMoney(cents){
 if(cents===null||cents===undefined)return 'Não confirmado';
 if(!/^-?\d+$/.test(String(cents)))throw Error('Valor monetário histórico inválido.');
 const n=BigInt(cents),a=n<0n?-n:n;return (n<0n?'-':'')+'R$ '+new Intl.NumberFormat('pt-BR').format(a/100n)+','+(a%100n).toString().padStart(2,'0');
}
