import http from "node:http";
import {randomUUID} from "node:crypto";

const base = {host:"127.0.0.1", port: 18092};

function req(method, path, headers={}, body){
  return new Promise((resolve,reject)=>{
    const h = {"content-type":"application/json", ...headers};
    const data = body?JSON.stringify(body):null;
    if(data) h["content-length"]=Buffer.byteLength(data);
    const r = http.request({...base, method, path, headers:h}, res=>{
      let b=""; res.on("data",c=>b+=c); res.on("end",()=>{try{resolve({status:res.statusCode, body: b?JSON.parse(b):null})}catch(e){resolve({status:res.statusCode, body:b})}});
    });
    r.on("error",reject);
    if(data) r.write(data);
    r.end();
  });
}

async function run(){
  try {
    const cat = await req("GET","/api/pos/catalog");
    console.log("CATALOG_STATUS", cat.status);
    console.log("CATALOG_COUNT", cat.body?.count||0);
  } catch(e){ console.log("ERR", e.message); }
}
run();
