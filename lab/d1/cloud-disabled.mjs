const unavailable=async()=>{throw Error('Serviço de nuvem indisponível neste laboratório offline.');};
export const getAccessToken=unavailable;
export const renovarSessao=async()=>({ok:false,mensagem:'Somente sessão local neste laboratório.'});
export const supabaseAuth={getSession:async()=>({data:{session:null}})};
export const supabase={auth:{getSession:supabaseAuth.getSession},storage:{from:()=>({upload:unavailable,createSignedUrl:unavailable,remove:unavailable})}};
