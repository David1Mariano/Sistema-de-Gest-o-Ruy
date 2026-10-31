// Browser contracts never acquire the trusted server request context. The
// actual authority and operational validation remain inside the central API.
export const centralOperational=()=>false;
export const centralContext=()=>undefined;
