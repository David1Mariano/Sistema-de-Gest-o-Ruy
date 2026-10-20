const fs=require('node:fs'),path=require('node:path');
exports.startupLog=(directory,revision,event,stage,error)=>{
 try{
  fs.mkdirSync(directory,{recursive:true});
  const safe=value=>String(value||'').replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,80);
  const row={time:new Date().toISOString(),pid:process.pid,revision:safe(revision),event:safe(event),stage:safe(stage)};
  if(error){row.errorName=safe(error.name);row.errorCode=safe(error.code);}
  fs.appendFileSync(path.join(directory,'startup.jsonl'),JSON.stringify(row)+'\n');
 }catch{/* No permission changes or raw error output. */}
};
