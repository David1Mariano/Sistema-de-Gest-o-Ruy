export const localOrigin = 'http://127.0.0.1:18087';
export function allowedNavigation(value) {
  try { const u = new URL(value); return u.origin === localOrigin && !u.username && !u.password; }
  catch { return false; }
}
export const webPreferences = Object.freeze({
  nodeIntegration: false, contextIsolation: true, sandbox: true,
  webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
});
