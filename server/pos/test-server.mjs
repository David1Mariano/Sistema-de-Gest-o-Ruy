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

const devices = new Map();
const orders = new Map();

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
    const baseQuery = async(sql, params=[])=>{
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
          const th = params[0];
          for (const d of devices.values()){ if(d.token_hash===th) return {rows:[{id:d.id, terminal_code:d.terminal_code, workspace_id:d.workspace_id, active:d.active, revoked_at:d.revoked_at}], rowCount:1}; }
          return {rows:[], rowCount:0};
        }
        if(s.includes("where terminal_code")){
          const tc = params[0];
          for (const d of devices.values()){ if(d.terminal_code===tc) return {rows:[d], rowCount:1}; }
          return {rows:[], rowCount:0};
        }
        return {rows:[], rowCount:0};
      }
      if(s.includes("insert into pos_devices")){
        const id = "dev-"+Date.now();
        const d = {id, workspace_id: params[0]||null, terminal_code: params[1], name: params[2]||params[1], token_hash: params[3], active: true, revoked_at: null};
        devices.set(id,d);
        return {rows:[d], rowCount:1};
      }
      if(s.includes("update pos_devices")){
        if(s.includes("revoked_at")){
          // mark first or find
          for (const d of devices.values()){ d.revoked_at=new Date().toISOString(); d.active=false; devices.set(d.id,d); break; }
        } else if(s.includes("last_seen_at")){
          // ok
        }
        return {rows:[], rowCount:1};
      }
      if(s.includes("from pos_orders")){
        if(s.includes("where id")){
          const oid = params[0];
          if(orders.has(oid)) return {rows:[orders.get(oid)], rowCount:1};
          return {rows:[], rowCount:0};
        }
        return {rows:[], rowCount:0};
      }
      if(s.includes("insert into pos_orders")){
        const oid = params[0];
        const o = {id:oid, workspace_id: params[1]||null, device_id: params[2], operator_id: params[3]||null, status:'RECEIVED', payment_status: params[5], sync_status:'RECEIVED', total_cents: params[6], items: typeof params[7]==='string'?JSON.parse(params[7]):params[7], meta: params[8]? (typeof params[8]==='string'?JSON.parse(params[8]):params[8]):null};
        orders.set(oid,o);
        return {rows:[{id:oid, payment_status: params[5]}], rowCount:1};
      }
      if(s.includes("update pos_orders")){
        return {rows:[], rowCount:1};
      }
      return {rows:[], rowCount:0};
    };
    const client = { query: baseQuery, release: async ()=>{} };
    const pool = {query: baseQuery, connect: async () => ({ query: baseQuery, release: async ()=>{} })};
    await posRoutes(pool, req, res, url, body);
  } catch(e) {
    res.writeHead(e.status||500,{"content-type":"application/json"});
    res.end(JSON.stringify({error:e.message}));
  }
});
server.listen(18092, "127.0.0.1", ()=>{ console.log("pos-test 18092 on 127.0.0.1"); });
