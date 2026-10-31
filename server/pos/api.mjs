import {randomBytes, createHash} from "node:crypto";
import {fail} from "../d1-lab/core.mjs";

function hashToken(t){ return createHash("sha256").update(t).digest("hex"); }
function genToken(){ return randomBytes(32).toString("hex"); }

async function requirePosDevice(pool, req){
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer ([a-f0-9]{64})$/);
  if(!m) throw fail(401, "unauthorized");
  const th = hashToken(m[1]);
  const r = await pool.query("SELECT id, terminal_code, workspace_id, active, revoked_at FROM pos_devices WHERE token_hash=$1",[th]);
  if(r.rowCount===0) throw fail(401, "unauthorized");
  const d = r.rows[0];
  if(d.revoked_at || d.active===false) throw fail(403, "device_revoked");
  await pool.query("UPDATE pos_devices SET last_seen_at=now() WHERE id=$1",[d.id]);
  return d;
}

function checkAdminKey(req){
  const adminKey = req.headers["x-ruy-admin-key"];
  const configured = process.env.POS_ADMIN_KEY || "";
  if(!configured || configured.length < 32) throw fail(500, "admin_key_not_configured");
  if(!adminKey || typeof adminKey !== "string") throw fail(403, "admin_authorization_required");
  if(adminKey.length !== configured.length) throw fail(403, "admin_authorization_required");
  let diff = 0;
  for(let i=0;i<adminKey.length;i++){ diff |= adminKey.charCodeAt(i) ^ configured.charCodeAt(i); }
  if(diff !== 0) throw fail(403, "admin_authorization_required");
  return true;
}

export async function posRoutes(pool, req, res, url, body){
  const reply=(status,obj)=>{res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(obj));};
  
  if(req.method==="GET" && url.pathname==="/api/pos/catalog"){
    try {
      const r = await pool.query("SELECT id, data, version, updated_at FROM d2_catalog WHERE entity='InventoryItem' ORDER BY id");
      const items = r.rows.map(row => {
        const d = row.data?.payload_json ? JSON.parse(row.data.payload_json) : (row.data || {});
        return {
          id: row.id,
          sku: d.sku || d.code || null,
          name: d.name || "",
          category: d.category || d.category_name || null,
          price_cents: Math.round(Number(d.sale_price || d.price || d.unit_price || 0) * 100),
          active: (d.status || "ativo") === "ativo",
          image_url: d.image_url || null,
          version: Number(row.version || 1),
          updated_at: row.updated_at,
          unit: d.unit || "un"
        };
      }).filter(i => i.active);
      return reply(200,{items, source:"d2_catalog", count: items.length});
    } catch(e) {
      throw fail(500, "catalog_unavailable");
    }
  }
  
  if(req.method==="POST" && url.pathname==="/api/pos/auth/device/provision"){
    checkAdminKey(req);
    const {terminal_code, workspace_id, name} = body||{};
    if(!terminal_code) throw fail(400,"terminal_code required");
    const client = await pool.connect();
    try{
      await client.query("BEGIN");
      const tok = genToken();
      const th = hashToken(tok);
      let row = (await client.query("SELECT * FROM pos_devices WHERE terminal_code=$1",[terminal_code])).rows[0];
      if(row && row.revoked_at){ await client.query("ROLLBACK"); throw fail(409, "device_revoked_exists"); }
      if(row){ await client.query("ROLLBACK"); throw fail(409, "device_exists"); }
      row = (await client.query("INSERT INTO pos_devices (workspace_id,terminal_code,name,token_hash,active) VALUES($1,$2,$3,$4,true) RETURNING *",[workspace_id||null,terminal_code,name||terminal_code,th])).rows[0];
      await client.query("COMMIT");
      return reply(201,{token:tok, device_id:row.id, terminal_code:row.terminal_code, workspace_id:row.workspace_id, provisioned:true});
    }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
  }
  
  if(req.method==="POST" && url.pathname==="/api/pos/auth/device"){
    throw fail(403, "auto_registration_disabled_use_provision");
  }
  
  if(req.method==="POST" && url.pathname==="/api/pos/orders"){
    const device = await requirePosDevice(pool, req);
    const idempotency = req.headers["idempotency-key"] || body?.id;
    if(!idempotency) throw fail(400,"Idempotency-Key required");
    const {items,total_cents,payment_status,operator_id,workspace_id,meta,stone_transaction_id} = body||{};
    if(!Array.isArray(items)||items.length===0) throw fail(400,"items required");
    if(typeof total_cents!=="number") throw fail(400,"total_cents required");
    const pstatus = payment_status||"UNPAID";
    if(!["UNPAID","PENDING","PAID","REFUSED","CANCELLED","REFUNDED","UNKNOWN"].includes(pstatus)) throw fail(400,"invalid payment_status");
    
    const existing = await pool.query("SELECT id, items, total_cents, payment_status, device_id FROM pos_orders WHERE id=$1",[idempotency]);
    if(existing.rowCount>0){
      const ex = existing.rows[0];
      if(ex.device_id && ex.device_id !== device.id) throw fail(403, "order_belongs_to_other_device");
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
        [idempotency, workspace_id||null, device.id, operator_id||null, pstatus, total_cents, JSON.stringify(items), meta?JSON.stringify(meta):null, stone_transaction_id||null]);
      await client.query("COMMIT");
      return reply(201,{id:r.rows[0].id, persisted:true, status:r.rows[0].payment_status});
    }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
  }
  
  if(req.method==="GET" && url.pathname.match(/^\/api\/pos\/orders\/[a-f0-9-]+$/)){
    const device = await requirePosDevice(pool, req);
    const id = url.pathname.split("/").pop();
    const r = await pool.query("SELECT * FROM pos_orders WHERE id=$1",[id]);
    if(r.rowCount===0) throw fail(404,"not_found");
    if(r.rows[0].device_id && r.rows[0].device_id !== device.id) throw fail(403, "forbidden");
    return reply(200,r.rows[0]);
  }
  
  if(req.method==="POST" && url.pathname==="/api/pos/payments/confirm"){
    throw fail(403, "disabled_in_homolog");
  }
  
  throw fail(404,"Unknown POS route");
}
