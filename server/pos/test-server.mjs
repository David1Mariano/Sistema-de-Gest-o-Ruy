import http from "http";
import {posRoutes} from "./api.mjs";

const rate = new Map();
function checkRate(ip){
  const now = Date.now();
  const k = ip;
  const arr = (rate.get(k)||[]).filter(t=>now-t<60000);
  if(arr.length>=60){ rate.set(k,arr); return false; }
  arr.push(now); rate.set(k,arr); return true;
}

const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url || "/", "http://127.0.0.1:18092");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key, x-ruy-admin-key");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if(req.method === "OPTIONS"){ res.writeHead(204); res.end(); return; }
  if(req.method !== "GET" && req.method !== "POST"){ res.writeHead(405,{"content-type":"application/json","allow":"GET,POST,OPTIONS"}); res.end(JSON.stringify({error:"method_not_allowed"})); return; }
  const ip = req.socket.remoteAddress || "unknown";
  if(!checkRate(ip)){ res.writeHead(429,{"content-type":"application/json"}); res.end(JSON.stringify({error:"rate_limited"})); return; }
  let body = null;
  if(req.method === "POST"){
    const chunks = [];
    for await(const c of req) chunks.push(c);
    const buf = Buffer.concat(chunks);
    if(buf.length > 65536){ res.writeHead(413,{"content-type":"application/json"}); res.end(JSON.stringify({error:"payload_too_large"})); return; }
    try{ body = JSON.parse(buf.toString()); }catch{ body = null; }
  }
  try {
    const pool = {query: async(sql, params=[])=>{
      const s = sql.toLowerCase();
      if(s.includes("select id, data, version, updated_at from d2_catalog")){
        return {rows: [
          {id:"11111111-1111-1111-1111-111111111111", data:{payload_json: JSON.stringify({name:"Coxinha", category:"Salgados", status:"ativo", price:8.00})}, version:1, updated_at:new Date().toISOString()},
          {id:"22222222-2222-2222-2222-222222222222", data:{payload_json: JSON.stringify({name:"Caldo de cana 300ml", category:"Bebidas", status:"ativo", price:7.00})}, version:1, updated_at:new Date().toISOString()},
          {id:"33333333-3333-3333-3333-333333333333", data:{payload_json: JSON.stringify({name:"Pastelão", category:"Salgados", status:"ativo", price:12.00})}, version:1, updated_at:new Date().toISOString()}
        ], rowCount:3};
      }
      if(s.includes("from pos_devices")){
        if(s.includes("where token_hash")){
          return {rows:[{id:"dev-test-001", terminal_code:"TERM-TEST-001", workspace_id:null, active:true, revoked_at:null}], rowCount:1};
        }
        return {rows:[], rowCount:0};
      }
      if(s.includes("update pos_devices")){
        return {rows:[], rowCount:1};
      }
      if(s.includes("from pos_orders")){
        if(s.includes("where id")){
          // simulate existing order for test
          return {rows:[], rowCount:0};
        }
        return {rows:[], rowCount:0};
      }
      if(s.includes("insert into pos_orders")){
        return {rows:[{id: params[0], payment_status: params[5]}], rowCount:1};
      }
      if(s.includes("update pos_orders")){
        return {rows:[], rowCount:1};
      }
      return {rows:[], rowCount:0};
    }};
    await posRoutes(pool, req, res, url, body);
  } catch(e) {
    res.writeHead(e.status||500,{"content-type":"application/json"});
    res.end(JSON.stringify({error:e.message}));
  }
});
server.listen(18092, "127.0.0.1", ()=>{ console.log("pos-test 18092 on 127.0.0.1"); });
