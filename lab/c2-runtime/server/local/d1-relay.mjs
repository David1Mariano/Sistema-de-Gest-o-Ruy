// Explicit synthetic-lab gateway. No credentials or data are logged here.
export async function relayD1(req,res,origin){
  const url=new URL(req.url,'http://127.0.0.1');
  if(!url.pathname.startsWith('/api/local/d1/'))return false;
  const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(!origin){reply(403,{error:'Bridge disabled.'});return true;}
  const isolated=process.env.RUY_D1_ALLOW_TESTS==='1'&&process.env.RUY_D1_INSTALLATION==='i5r4-dev-20261020'&&process.env.RUY_D1_TEST_API_PORT==='18113';
  const legacyAllowed=['http://127.0.0.1:18086','http://127.0.0.1:18090','http://127.0.0.1:18094'].includes(origin)&&(!origin.endsWith(':18094')||process.env.RUY_D1_ALLOW_TESTS==='1');
  if(!(isolated?origin==='http://127.0.0.1:18555':legacyAllowed))throw Error('Invalid synthetic central origin');
  const push=url.pathname==='/api/local/d1/push'&&req.method==='POST';
  const pull=url.pathname==='/api/local/d1/changes'&&req.method==='GET';
  const attachment=url.pathname.match(/^\/api\/local\/d1\/attachments\/([a-f0-9-]{36})$/);
  const list=url.pathname==='/api/local/d1/attachments'&&req.method==='GET'&&/^\?record=[a-f0-9-]{36}$/.test(url.search);
  const upload=attachment&&req.method==='PUT'&&!url.search;
  const download=attachment&&req.method==='GET'&&!url.search;
  if(!push&&!pull&&!upload&&!download&&!list){reply(404,{error:'Not found.'});return true;}
  if(req.headers.cookie||!/^Bearer [a-f0-9]{64}$/.test(req.headers.authorization||'')){reply(403,{error:'Device credential required.'});return true;}
  if(req.headers.origin){reply(403,{error:'Server transport only.'});return true;}
  let body;
  if(push||upload){
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){reply(415,{error:'JSON required.'});return true;}
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>1024*1024){reply(413,{error:'Body too large.'});return true;}chunks.push(chunk);}
    body=Buffer.concat(chunks);
  }else if(pull&&!/^\?cursor=\d+$/.test(url.search)){reply(400,{error:'Invalid cursor.'});return true;}
  try{
    const upstream=await fetch(origin+'/d1/'+(list?'attachments'+url.search:attachment?'attachments/'+attachment[1]:push?'push':'changes'+url.search),{method:req.method,redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:req.headers.authorization,...(push||upload?{'Content-Type':'application/json'}:{})},body});
    const value=await upstream.json();
    if(upstream.ok)reply(upstream.status,value);
    else reply([400,401,403,409,413].includes(upstream.status)?upstream.status:503,{error:'Synthetic central refused request.'});
  }catch{reply(503,{error:'Synthetic central unavailable.'});}
  return true;
}
