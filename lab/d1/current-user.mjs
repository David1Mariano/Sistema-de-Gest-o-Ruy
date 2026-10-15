import {getSession} from './client.mjs';
export {currentUserName} from '../../src/lib/currentUserStore.js';
export const useCurrentUser=()=>getSession()?.user;
