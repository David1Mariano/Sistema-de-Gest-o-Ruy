import {randomBytes, createHash} from "node:crypto";
import {fail} from "../d1-lab/core.mjs";

function hashToken(t){ return createHash("sha256").update(t).digest("hex"); }
function genToken(){ return randomBytes(32).toString("hex"); }

export async function posRoutes(pool, req, res, url, body){
  const reply=(status,obj)=>{res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(obj));};
  
  if(req.method==="GET" && url.pathname==="/api/pos/catalog"){
    const ws = url.searchParams.get("workspace_id");
    const q = ws ? "SELECT id, sku, name, category, price_cents, active, image_url, version, updated_at FROM pos_catalog WHERE workspace_id=$1 AND active=true ORDER BY category,name" : "SELECT id, sku, name, category, price_cents, active, image_url, version, updated_at FROM pos_catalog WHERE active=true ORDER BY category,name";
    const r = ws ? await pool.query(q,[ws]) : await pool.query(q);
    return reply(200,{items:r.rows});
  }
  
  if(req.method==="POST" && url.pathname==="/api/pos/auth/device"){
    const {terminal_code, workspace_id} = body||{};
    if(!terminal_code) throw fail(400,"terminal_code required");
    const client = await pool.connect();
    try{
      await client.query("BEGIN");
      const tok = genToken();
      const th = hashToken(tok);
      let row = (await client.query("SELECT * FROM pos_devices WHERE terminal_code=$1",[terminal_code])).rows[0];
      if(!row){
        row = (await client.query("INSERT INTO pos_devices (workspace_id,terminal_code,name,token_hash) VALUES($1,$2,$3,$4) RETURNING *",[workspace_id||null,terminal_code,body?.name||terminal_code,th])).rows[0];
      }else{
        if(row.revoked_at) throw fail(403,"device_revoked");
        await client.query("UPDATE pos_devices SET token_hash=$1, updated_at=now(), last_seen_at=now() WHERE id=$2",[th,row.id]);
        row = (await client.query("SELECT * FROM pos_devices WHERE id=$1",[row.id])).rows[0];
      }
      await client.query("COMMIT");
      return reply(200,{token:tok, device_id:row.id, terminal_code:row.terminal_code, workspace_id:row.workspace_id});
    }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
  }
  
  if(req.method==="POST" && url.pathname==="/api/pos/orders"){
    const idempotency = req.headers["idempotency-key"] || body?.id;
    if(!idempotency) throw fail(400,"Idempotency-Key required");
    const {items,total_cents,payment_status,operator_id,device_id,workspace_id,meta,stone_transaction_id} = body||{};
    if(!Array.isArray(items)||items.length===0) throw fail(400,"items required");
    if(typeof total_cents!=="number") throw fail(400,"total_cents required");
    const pstatus = payment_status||"UNPAID";
    if(!["UNPAID","PENDING","PAID","REFUSED","CANCELLED","REFUNDED","UNKNOWN"].includes(pstatus)) throw fail(400,"invalid payment_status");
    
    const existing = await pool.query("SELECT id, items, total_cents, payment_status FROM pos_orders WHERE id=$1",[idempotency]);
    if(existing.rowCount>0){
      const ex = existing.rows[0];
      if(JSON.stringify(ex.items)!==JSON.stringify(items)||ex.total_cents!==total_cents){
        throw fail(409,"idempotency_conflict");
      }
      return reply(200,{id:ex.id, persisted:true, status:ex.payment_status});
    }
    
    const client = await pool.connect();
    try{
      await client.query("BEGIN");
      const r = await client.query(`INSERT INTO pos_orders (id,workspace_id,device_id,operator_id,status,payment_status,sync_status,total_cents,items,meta,stone_transaction_id)
        VALUES($1,$2,$3,$4,'RECEIVED',$5,'RECEIVED',$6,$7,$8,$9) RETURNING id,payment_status`,
        [idempotency, workspace_id||null, device_id||null, operator_id||null, pstatus, total_cents, JSON.stringify(items), meta?JSON.stringify(meta):null, stone_transaction_id||null]);
      await client.query("COMMIT");
      return reply(201,{id:r.rows[0].id, persisted:true, status:r.rows[0].payment_status});
    }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
  }
  
  if(req.method==="GET" && url.pathname.match(/^\/api\/pos\/orders\/[a-f0-9-]+$/)){
    const id = url.pathname.split("/").pop();
    const r = await pool.query("SELECT * FROM pos_orders WHERE id=$1",[id]);
    if(r.rowCount===0) throw fail(404,"not_found");
    return reply(200,r.rows[0]);
  }
  
  if(req.method==="POST" && url.pathname==="/api/pos/payments/confirm"){
    const {order_id, stone_transaction_id, payment_status} = body||{};
    if(!order_id) throw fail(400,"order_id required");
    if(!["PAID","REFUSED","CANCELLED","REFUNDED","UNKNOWN"].includes(payment_status||"")) throw fail(400,"invalid payment_status");
    const client = await pool.connect();
    try{
      await client.query("BEGIN");
      const ord = (await client.query("SELECT * FROM pos_orders WHERE id=$1 FOR UPDATE",[order_id])).rows[0];
      if(!ord) throw fail(404,"order_not_found");
      if(ord.payment_status==="PAID") { await client.query("COMMIT"); return reply(200,{id:ord.id, payment_status:"PAID", already:true}); }
      await client.query(`UPDATE pos_orders SET payment_status=$1, stone_transaction_id=COALESCE($2,stone_transaction_id), 
        paid_at=CASE WHEN $1='PAID' THEN now() ELSE paid_at END,
        updated_at=now() WHERE id=$3`,[payment_status, stone_transaction_id||null, order_id]);
      await client.query("COMMIT");
      return reply(200,{id:order_id, payment_status, updated:true});
    }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
  }
  
  throw fail(404,"Unknown POS route");
}
