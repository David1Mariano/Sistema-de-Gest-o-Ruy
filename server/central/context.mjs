import {AsyncLocalStorage} from 'node:async_hooks';
const scope=new AsyncLocalStorage();
// Only the validated server factory establishes this context, never HTTP input.
export const centralContext=()=>scope.getStore();
export const centralOperational=()=>scope.getStore()?.operational===true;
export const withinCentral=(context,fn)=>context?scope.run(Object.freeze(context),fn):fn();
