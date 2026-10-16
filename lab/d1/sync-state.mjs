// Ausência de pendências sozinha nunca comprova sincronização.
export function syncState(s){
 if(!s)return 'unknown';
 if(s.lastError||s.conflicts>0||s.rejected>0)return 'error';
 if(s.sending>0)return 'syncing';
 if(s.pending>0||s.pendingFiles>0||s.pendingBusiness>0)return 'pending';
 const counters=['pending','sending','conflicts','rejected'];
 if(counters.some(key=>!Number.isSafeInteger(s[key])||s[key]<0))return 'unknown';
 if(s.operationalSyncEnabled!==true||s.mode!=='operational')return 'unknown';
 if(s.enabled===true&&Number.isFinite(Date.parse(s.lastSyncAt))&&s.receiptsVerified===true&&s.pullComplete===true&&Number.isSafeInteger(s.cursor)&&s.cursor>=0)return 'confirmed';
 return 'unknown';
}

export function attachmentStatus(s){
 if(s?.attachmentsState==='not-implemented')return 'Anexos: sincronização ainda não implementada; pendências desconhecidas.';
 if(Number.isSafeInteger(s?.pendingFiles)&&s.pendingFiles>0)return `Anexos: ${s.pendingFiles} pendente(s).`;
 return 'Anexos: confirmação remota não verificada.';
}
