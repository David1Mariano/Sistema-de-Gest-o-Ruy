import {installationFor} from './installation.mjs';
// Capabilities belong to the compiled installation, never localStorage or renderer flags.
export function attachmentsEnabled(env=process.env){
 return installationFor(env)?.attachments===true||env.RUY_D1_ALLOW_TESTS==='1'&&env.RUY_D1_ATTACHMENTS_LAB==='1';
}
export function deliveryCapability(env=process.env){
 return installationFor(env)?.delivery===true||env.RUY_D1_ALLOW_TESTS==='1'&&env.RUY_D1_DELIVERY_LAB==='1'&&env.RUY_D1_RESTART_FIXTURE==='e5aaec701010f607';
}
