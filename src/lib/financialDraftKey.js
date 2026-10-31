import {draftEditKey} from './draftConfig.js';
// An older draft is retained under its old key, but can never silently replace
// a newer central version (including a payment confirmed by another client).
export function financialDraftKey(formKey,editing){
 const base=draftEditKey(formKey,editing?.id);
 return editing?.id&&Number.isSafeInteger(editing._version)&&editing._version>0?`${base}:central-v${editing._version}`:base;
}
