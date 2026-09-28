let user = null;
export const setCurrentUser = (value) => { user = value; };
export const currentUserName = () => user?.full_name || user?.email || 'Sistema';
