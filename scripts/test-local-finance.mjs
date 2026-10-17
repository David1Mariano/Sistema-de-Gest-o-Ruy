import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createFinanceRepository, FINANCIAL_ENTITIES } from './local-finance/repository.mjs';
import { createFinanceAttachmentAuthorizer } from './local-finance/attachments.mjs';
import { createFinanceApi } from './local-finance/api.mjs';
import { createLocalFinanceClient } from '../src/lib/localFinanceApi.js';
import http from 'node:http';

// Explicit test runtime path only. Never accepts DATABASE_URL or production data.
if (!process.env.RUY_FINANCE_TEST_RUNTIME) throw new Error('Set RUY_FINANCE_TEST_RUNTIME to an isolated @electric-sql/pglite installation.');
const { PGlite } = await import(pathToFileURL(`${process.env.RUY_FINANCE_TEST_RUNTIME}/node_modules/@electric-sql/pglite/dist/index.js`).href);
const db = new PGlite(); // in-memory PostgreSQL engine, synthetic fixtures only
await db.exec(await readFile(new URL('./local-finance/schema.sql', import.meta.url), 'utf8'));
const pool = { connect: async () => ({ query: (sql, params) => db.query(sql, params), release() {} }) };
const repo = createFinanceRepository({ pool, authorizeAttachment: async ({value}) => value === `ruy-anexo://anx_${'a'.repeat(32)}` });
const actor = { id: 'fictional-finance-user', role: 'finance' };
const create = (entity,id,data = {}) => ({ action: 'create', entity,id,data });
try {
  await assert.rejects(repo.execute({id:'reader',role:'finance_read'}, 'op-denied', [create('Revenue','denied')]), /forbidden/);
  for (const entity of FINANCIAL_ENTITIES) await repo.execute(actor, `seed-${entity}`, [create(entity, `fixture-${entity}`, { name: 'Ficticio', amount: 10 })]);
  const expense = create('FinancialExpense','expense-test',{ amount: 35.5, category_id:'fixture-ExpenseCategory', account_id:'fixture-FinancialAccount', cost_center_id:'fixture-CostCenter', anexo:`ruy-anexo://anx_${'a'.repeat(32)}` });
  const first = await repo.execute(actor,'op-expense-create',[expense]);
  assert.deepEqual(await repo.execute(actor,'op-expense-create',[expense]),first);
  await assert.rejects(repo.execute(actor,'op-expense-create',[{...expense,data:{amount:40}}]),/operation_conflict/);
  await assert.rejects(repo.execute(actor,'op-bad-money',[create('Revenue','money',{amount:0.001})]),/invalid_money/);
  await assert.rejects(repo.execute(actor,'op-bad-link',[create('FinancialExpense','broken',{category_id:'missing'})]));
  assert.equal(await repo.get(actor,'FinancialExpense','broken'),null);
  await assert.rejects(repo.execute(actor,'op-bad-proof',[create('FinancialExpense','proof',{anexo:'ruy-anexo://invalid'})]),/attachment_forbidden/);
  await repo.execute(actor,'op-pay-batch',[
    { action:'update',entity:'AccountsPayable',id:'fixture-AccountsPayable',expectedVersion:1,data:{status:'paid',paid_amount:10} },
    create('CashMovement','payment-movement',{amount:-10,payable_id:'fixture-AccountsPayable',account_id:'fixture-FinancialAccount'}),
  ]);
  await assert.rejects(repo.execute(actor,'op-stale-edit',[{action:'update',entity:'AccountsPayable',id:'fixture-AccountsPayable',expectedVersion:1,data:{status:'pending'}}]),/version_conflict/);
  await assert.rejects(repo.execute(actor,'op-rollback',[
    create('Revenue','rollback-first',{amount:5}),
    { action:'update',entity:'FinancialAccount',id:'fixture-FinancialAccount',expectedVersion:99,data:{balance:20} },
  ]),/version_conflict/);
  assert.equal(await repo.get(actor,'Revenue','rollback-first'),null);
  await repo.execute(actor,'op-close-cash',[create('DailyFinancialClose','daily-close',{date:'2026-01-01',total:10}),create('FechamentoCaixa','cash-close',{date:'2026-01-01',total:10})]);
  assert.equal((await repo.list(actor,'AccountsPayable',{status:'paid'},'-created_date',10)).length,1);
  assert.equal((await db.query('SELECT * FROM ruy_finance.audit WHERE operation_id=$1',['op-pay-batch'])).rows.length,2);
  assert.equal((await db.query('SELECT * FROM ruy_finance.operation WHERE id=$1',['op-rollback'])).rows.length,0);
  const reference = `ruy-anexo://anx_${'a'.repeat(32)}`;
  const meta = {entity:'FinancialExpense',record_id:'expense-test',field:'anexo',owner:{id:actor.id}};
  const checkAttachment = createFinanceAttachmentAuthorizer({getMeta:async()=>meta,readContent:async()=>Buffer.from('fictional')});
  const attachmentContext = {actor,entity:'FinancialExpense',recordId:'expense-test',field:'anexo',value:reference};
  assert.equal(await checkAttachment(attachmentContext),true);
  assert.equal(await checkAttachment({...attachmentContext,recordId:'another-record'}),false);
  assert.equal(await checkAttachment({...attachmentContext,actor:{id:'another-user',role:'finance'}}),false);
  await assert.rejects(createFinanceAttachmentAuthorizer({getMeta:async()=>meta,readContent:async()=>{throw new Error('integrity_failed');}})(attachmentContext),/integrity_failed/);
  const api = createFinanceApi({repository:repo,authenticate:async req=>req.headers.authorization === 'Bearer fictional-token' ? actor : null});
  const server = http.createServer(api);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const client = createLocalFinanceClient({baseUrl,getToken:()=> 'fictional-token'});
    const created = await client.entity('Revenue').create({id:'http-revenue',amount:50},'op-http-revenue');
    assert.equal(created.amount,50);
    assert.equal((await client.entity('Revenue').get(created.id)).version,1);
    assert.equal((await client.entity('Revenue').update(created.id,{amount:60},{expectedVersion:1,operationId:'op-http-update'})).version,2);
    assert.equal((await fetch(`${baseUrl}/api/financeiro/entities/Revenue`)).status,401);
    assert.equal((await fetch(`${baseUrl}/api/financeiro/entities/Revenue`,{headers:{Authorization:'Bearer fictional-token',Origin:'https://foreign.invalid'}})).status,403);
  } finally { await new Promise(resolve=>server.close(resolve)); }
  console.log('PASS: 15 entities; permissions; expense; atomic payment; closing; references; attachment gate; idempotency; CAS; rollback; audit.');
} finally { await db.close(); }
