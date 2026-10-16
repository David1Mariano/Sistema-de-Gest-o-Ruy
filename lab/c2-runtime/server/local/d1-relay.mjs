// Explicit synthetic-lab gateway. No credentials or data are logged here.
export async function relayD1(req,res,origin){
  const url=new URL(req.url,'http://127.0.0.1');
  if(!url.pathname.startsWith('/api/local/d1/'))return false;
  const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(!origin){reply(403,{error:'Bridge disabled.'});return true;}
  if(!['http://127.0.0.1:18086','http://127.0.0.1:18090'].includes(origin))throw Error('Invalid synthetic central origin');
  const push=url.pathname==='/api/local/d1/push'&&req.method==='POST';
  const pull=url.pathname==='/api/local/d1/changes'&&req.method==='GET';
  if(!push&&!pull){reply(404,{error:'Not found.'});return true;}
  if(req.headers.cookie||!/^Bearer [a-f0-9]{64}$/.test(req.headers.authorization||'')){reply(403,{error:'Device credential required.'});return true;}
  if(req.headers.origin){reply(403,{error:'Server transport only.'});return true;}
  let body;
  if(push){
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){reply(415,{error:'JSON required.'});return true;}
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>1024*1024){reply(413,{error:'Body too large.'});return true;}chunks.push(chunk);}
    body=Buffer.concat(chunks);
  }else if(!/^\?cursor=\d+$/.test(url.search)){reply(400,{error:'Invalid cursor.'});return true;}
  try{
    const upstream=await fetch(origin+'/d1/'+(push?'push':'changes'+url.search),{method:push?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:req.headers.authorization,...(push?{'Content-Type':'application/json'}:{})},body});
    const value=await upstream.json();
    if(upstream.ok)reply(upstream.status,value);
    else reply([400,401,403,409,413].includes(upstream.status)?upstream.status:503,{error:'Synthetic central refused request.'});
  }catch{reply(503,{error:'Synthetic central unavailable.'});}
  return true;
}
