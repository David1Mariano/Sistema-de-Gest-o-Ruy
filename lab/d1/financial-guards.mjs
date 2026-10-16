// Somente build D1: o fluxo legado do lote não pode iniciar escritas separadas.
export function guardFinancialBatches(source){
 source=integratePayrollBatches(source);
 const start=source.indexOf('function BatchPaymentDialog('),end=source.indexOf('function ConsumptionDialog(',start);
 if(start<0||end<0)throw Error('Contrato do formulário de lote mudou; revisar guarda D1.');
 const block=source.slice(start,end),anchor='  const save = async () => {';
 if(block.split(anchor).length!==2)throw Error('Comando de lote não identificado; build D1 bloqueado.');
 const guarded=block.replace(anchor,anchor+"\n    if(base44.localDomain)throw Error('Lote de vales/adiantamentos indisponível neste laboratório; use os cadastros individuais de RH. Nenhuma gravação foi executada.');");
 return source.slice(0,start)+guarded+source.slice(end);
}

export function integratePayrollBatches(source){
 const anchor="if(multi){setSaveError('Pagamento em lote aguarda homologação atômica. Registre individualmente.');return;}";
 if(source.split(anchor).length!==2)throw Error('Contrato do pagamento múltiplo mudou; revisar integração D1.');
 return source.replace(anchor,`if(multi){
        if(!selectedIds.length||saving)return;
        if(!window.confirm('Confirmar o registro local de '+selectedIds.length+' pagamento(s)? Será criada uma despesa vinculada por pagamento, sem transferência bancária ou alteração automática do caixa.'))return;
        setSaving(true);
        try{await base44.localDomain.batchPayments(selectedIds.map(id=>({employee_id:id,gross_amount:Number(rows[id].amount),discount_amount:0,net_amount:Number(rows[id].amount),payment_date:f.payment_date,payment_method:f.payment_method,status:f.status,payment_type:f.payment_type,observation:f.observation,reference_start:f.reference_start,reference_end:f.reference_end,work_date:f.work_date,days_quantity:f.days_quantity,daily_rate:f.daily_rate})));draft.markSaved();}
        catch(e){draft.markFailed();setSaveError(e?.message||'Não foi possível registrar o lote.');setSaving(false);return;}
        setSaving(false);onClose();await onSaved();return;
      }`);
}
