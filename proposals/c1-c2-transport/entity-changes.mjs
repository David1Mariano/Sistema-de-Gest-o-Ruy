// Targeted replacements, applied only in memory by synthetic tests.
export function proposeEntities(source) {
  const changes = [
    ["  function decode(row) {", "  function decode(row) {\n    if(!row || typeof row.id!=='string' || !row.data || typeof row.data!=='object' || Array.isArray(row.data) || !Number.isSafeInteger(Number(row.version)) || Number(row.version)<1)throw Object.assign(Error('Registro local inválido.'),{code:'INVALID_RESPONSE',outcome:'unknown'});"],
    ["  const get=async id=>", "  const records=value=>{if(!value || !Array.isArray(value.records))throw Object.assign(Error('Lista local inválida.'),{code:'INVALID_RESPONSE',outcome:'not_applicable'});return value.records;};\n  const get=async id=>"],
    ["if(!value.records.length)", "if(!records(value).length)"],
    ["all.push(...page.records.map(decode)); if(page.records.length<200)break;", "all.push(...records(page).map(decode)); if(page.records.length<200)break;"],
    ["    const result=await session.request(`records/${entity}/${id}`,payload);\n    pending.delete(key);\n    if(operation==='delete'){versions.delete(id);return {id,deleted:true,tombstone:true};}\n    return result.replay ? get(id) : decode(result);",
      "    try {\n      const result=await session.request(`records/${entity}/${id}`,payload);\n      if(result?.replay!==true) {\n        const decoded=decode(result);\n        if(decoded.id!==id || (operation==='delete' && result.deleted!==true))throw Object.assign(Error('Confirmação local inválida.'),{code:'INVALID_RESPONSE',outcome:'unknown'});\n      }\n      if(operation==='delete'){pending.delete(key);versions.delete(id);return {id,deleted:true,tombstone:true};}\n      const saved=result.replay ? await get(id) : decode(result);\n      pending.delete(key);return saved;\n    } catch(error) {\n      throw Object.assign(new Error(error.message),error,{operationId:payload.operationId,outcome:error.outcome||'unknown'});\n    }"],
    ["if(error.status && error.status<500)preparedUpdates.delete(updateKey);", "if(['rejected','not_sent'].includes(error.outcome))preparedUpdates.delete(updateKey);"],
  ];
  for(const [before,after] of changes) {
    if(!source.includes(before))throw Error('Baseline C2 mudou; revisão manual necessária.');
    source=source.replace(before,after);
  }
  return source;
}
