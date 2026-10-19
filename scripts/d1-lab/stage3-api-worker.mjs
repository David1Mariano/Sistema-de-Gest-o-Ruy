import pg from 'pg';
import {createServer} from '../../server/d1-lab/api.mjs';
if(!process.send||process.env.RUY_D1_ALLOW_TESTS!=='1'||process.env.RUY_D1_RESTART_FIXTURE!=='e5aaec701010f607'||process.env.RUY_D1_TEST_API_PORT!=='18091')throw Error('Isolated IPC test worker only.');
let pool,server;
process.on('message',async message=>{
 try{
  if(message.action==='start'&&!pool){
   const c=message.config;if(c.host!=='127.0.0.1'||c.port!==55437||!/^ruy_d1_rc_[a-f0-9]{16}$/.test(c.database))throw Error('Isolated database required.');
   pool=new pg.Pool(c);server=createServer(pool,message.deviceId);
   await new Promise((r,j)=>{server.once('error',j);server.listen(18091,'127.0.0.1',r);});process.send({ready:true});
  }else if(message.action==='stop'){
   if(server?.listening)await new Promise(r=>server.close(r));if(pool)await pool.end();process.disconnect();
  }
 }catch{process.send({failed:true});if(server?.listening)await new Promise(r=>server.close(r));if(pool)await pool.end();process.disconnect();process.exitCode=1;}
});
