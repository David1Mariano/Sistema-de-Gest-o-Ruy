import http from "http";
import {posRoutes} from "./api.mjs";

const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url || "/", "http://192.168.1.5:18092");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key, x-ruy-admin-key");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if(req.method === "OPTIONS"){ res.writeHead(204); res.end(); return; }
  let body = null;
  if(req.method === "POST" || req.method === "PUT"){
    const chunks = [];
    for await(const c of req) chunks.push(c);
    try{ body = JSON.parse(Buffer.concat(chunks).toString()); }catch{ body = null; }
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
server.listen(18092, "0.0.0.0", ()=>{ console.log("pos-test 18092 on 0.0.0.0"); });
