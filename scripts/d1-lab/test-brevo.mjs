import {test} from 'node:test';
import assert from 'node:assert/strict';
import {brevoSender} from '../../server/d1-lab/brevo-mail.mjs';
const config={apiKey:'synthetic-key-not-a-credential',senderEmail:'sender@example.invalid',senderVerified:true};
const message={to:'test@example.invalid',code:'123456',purpose:'verify'};
test('fixed official HTTPS endpoint, backend header, plain text; acceptance is not delivery',async()=>{
 const send=brevoSender(config,async(url,options)=>{assert.equal(url,'https://api.brevo.com/v3/smtp/email');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.ok(options.signal);assert.equal(options.headers['api-key'],config.apiKey);const body=JSON.parse(options.body);assert.deepEqual(body.to,[{email:message.to}]);assert.equal(body.sender.email,config.senderEmail);assert.ok(body.textContent.includes(message.code));assert.equal(options.body.includes(config.apiKey),false);return {status:201,json:async()=>({messageId:'synthetic-id'})};});
 assert.deepEqual(await send(message),{accepted:true,deliveryVerified:false});
});
test('requires verified sender and valid secret configuration',()=>{for(const change of [{apiKey:''},{senderVerified:false},{senderEmail:'bad\r\naddress'}])assert.throws(()=>brevoSender({...config,...change}),/CONFIGURATION_REQUIRED/);});
test('invalid recipient, purpose and code refused before network',async()=>{let calls=0;const send=brevoSender(config,async()=>{calls++;});for(const change of [{to:'bad\r\naddress'},{code:'anything'},{purpose:'other'}])await assert.rejects(()=>send({...message,...change}),/MESSAGE_REFUSED/);assert.equal(calls,0);assert.equal(send.accepts(message.to),true);});
for(const status of [200,202,400,401,403,429,500])test('HTTP '+status+' cannot claim acceptance and is not retried',async()=>{let calls=0;await assert.rejects(()=>brevoSender(config,async()=>{calls++;return {status,json:async()=>({messageId:'id',message:config.apiKey})};})(message),e=>e.message==='BREVO_ACCEPTANCE_NOT_CONFIRMED'&&e.providerStatus===status);assert.equal(calls,1);});
test('201 requires nonempty messageId and valid JSON',async()=>{for(const json of [async()=>({}),async()=>({messageId:''}),async()=>{throw Error(config.apiKey);}])await assert.rejects(()=>brevoSender(config,async()=>({status:201,json}))(message),e=>e.message==='BREVO_ACCEPTANCE_NOT_CONFIRMED');});
test('network, timeout and redirect errors are sanitized',async()=>{for(const kind of ['network','timeout','redirect'])await assert.rejects(()=>brevoSender(config,async()=>{throw Error(kind+config.apiKey+message.code);})(message),e=>e.message==='BREVO_ACCEPTANCE_NOT_CONFIRMED'&&e.providerStatus===null&&!e.cause);});
test('reset uses the same temporary server code contract',async()=>{await brevoSender(config,async(_url,options)=>{assert.match(JSON.parse(options.body).subject,/Redefinicao/);return {status:201,json:async()=>({messageId:'reset-id'})};})({...message,purpose:'reset'});});
