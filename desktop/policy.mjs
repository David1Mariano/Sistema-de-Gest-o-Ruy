const port=Number(process.env.RUY_D1_TEST_API_PORT||18087);
if(![18087,18091].includes(port)||port!==18087&&process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Porta de laboratório inválida.');
export const localOrigin = `http://127.0.0.1:${port}`;
export function allowedNavigation(value) {
  try { const u = new URL(value); return u.origin === localOrigin && !u.username && !u.password; }
  catch { return false; }
}
export const webPreferences = Object.freeze({
  nodeIntegration: false, contextIsolation: true, sandbox: true,
  webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
});
