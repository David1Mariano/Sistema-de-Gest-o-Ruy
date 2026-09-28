import { useAuth } from './AuthContext';
export { currentUserName } from './currentUserStore';
export function useCurrentUser() { return useAuth().user; }
