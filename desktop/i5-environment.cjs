const FIXTURE='e5aaec701010f607';
exports.configureI5Environment=(env,marker)=>{
 if(marker.purpose!=='RUY_D1_SYNTHETIC_ONLY'||marker.restartFixture!==FIXTURE||marker.port!==55437)throw Error('LAB_MARKER_INVALID');
 const required={RUY_D1_ALLOW_TESTS:'1',RUY_D1_RESTART_FIXTURE:FIXTURE,RUY_D1_TEST_API_PORT:'18091'};
 for(const [key,value] of Object.entries(required))if(env[key]!==undefined&&env[key]!==value)throw Error('LAB_ENV_CONFLICT');
 Object.assign(env,required);
 delete env.RUY_D1_DELIVERY_LAB;delete env.RUY_D1_DELIVERY_UI;
 return env;
};
