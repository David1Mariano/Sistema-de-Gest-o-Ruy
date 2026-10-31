let scope='signed-out',memory=[];
const key=()=>`ruy-notifications-v1:${scope}`;
export function notifications(){try{const value=JSON.parse(localStorage.getItem(key())||'[]');return Array.isArray(value)?value.filter(n=>n&&typeof n.id==='string'&&typeof n.message==='string'):[];}catch{return memory;}}
function save(items){memory=items.slice(0,100);try{localStorage.setItem(key(),JSON.stringify(memory));}catch{/* Notifications must never block a financial form. */}globalThis.dispatchEvent?.(new Event('ruy-notifications-changed'));}
export function setNotificationScope(id){scope=id||'signed-out';memory=[];globalThis.dispatchEvent?.(new Event('ruy-notifications-changed'));}
export function notify({id,message,kind='info'}){const items=notifications(),old=items.find(n=>n.id===id);if(old?.message===message&&old.kind===kind)return;save([{id,message,kind,read:false,at:new Date().toISOString()},...items.filter(n=>n.id!==id)]);}
export function markNotificationsRead(id){save(notifications().map(n=>!id||n.id===id?{...n,read:true}:n));}
