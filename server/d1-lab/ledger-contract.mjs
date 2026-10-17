import {uuid} from './core.mjs';
export const ledgerAccount=value=>['cash','bank','expense','revenue','equity'].includes(value)||typeof value==='string'&&value.startsWith('account:')&&uuid(value.slice(8));
export const assetAccount=value=>['cash','bank'].includes(value)||typeof value==='string'&&value.startsWith('account:');
