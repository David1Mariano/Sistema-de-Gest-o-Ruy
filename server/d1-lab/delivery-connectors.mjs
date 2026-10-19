import {canonicalProvider,deliveryStates} from './delivery-contract.mjs';
export const deliveryConnectorManifest=Object.freeze({version:'DELIVERY-PROVIDERS/1',ifood:{enabled:false},'99food':{enabled:false},whatsapp:{enabled:false},attendance:{enabled:false},payments:{enabled:false}});
// Adapter preparation only: never persists/imports an event or advances an order.
export function inspectDemonstrationEvent({channel,status}={}){
 const modes={balcao:'pickup',retirada:'pickup',local:'local'};
 const provider=Object.hasOwn(modes,channel)?'own':canonicalProvider(channel);
 return {provider,fulfillment:modes[channel]||null,status:deliveryStates.includes(status)?status:'unknown',decision:'blocked',externalEnabled:false};
}
export async function executeExternalDelivery(){throw Object.assign(Error('Integração externa Delivery exige homologação e autorização específicas.'),{status:501,code:'DELIVERY_EXTERNAL_DISABLED'});}
