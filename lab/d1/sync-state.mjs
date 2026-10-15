// Ausência de pendências sozinha nunca comprova sincronização.
export function syncState(s){
 if(!s)return 'unknown';
 if(s.lastError||s.conflicts>0||s.rejected>0)return 'error';
 if(s.sending>0)return 'syncing';
 if(s.pending>0||s.pendingFiles>0||s.pendingBusiness>0)return 'pending';
 if(s.enabled===true&&s.lastSyncAt&&s.receiptsVerified===true&&s.pullComplete===true&&Number.isSafeInteger(s.cursor))return 'confirmed';
 return 'unknown';
}
