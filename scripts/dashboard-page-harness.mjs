import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import Module from 'node:module';
import path from 'node:path';

// Execute the real page's hooks/loader with an in-memory dispatcher. Network
// and unrelated dialogs are stubbed; the overview cards are production JSX.
// This is a deterministic state/SSR test, not a browser or DOM test.
export async function financePageHarness(entities, page = 'Financeiro') {
  globalThis.__dashboardTestClient = { entities };
  const built = await build({
    entryPoints: [`src/pages/${page}.jsx`], bundle: true, write: false,
    platform: 'node', format: 'cjs', jsx: 'automatic', mainFields: ['module', 'main'],
    external: ['react', 'react/jsx-runtime'],
    define: { 'import.meta.env.DEV': 'false' },
    alias: { '@': path.resolve('src') },
    plugins: [{ name: 'read-only-fixtures', setup(build) {
      build.onResolve({ filter: /^@\/(api\/base44Client|lib\/(useUserRole|supabaseClient|useCurrentUser|usePersistentDraft)|components\/)/ }, args => {
        if (/FinancialOverviewCards|FinancialStat|DirectionMetric/.test(args.path)) return;
        return { path: args.path, namespace: 'fixture' };
      });
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
        if (args.path.endsWith('base44Client')) return { contents: 'export const base44 = globalThis.__dashboardTestClient;' };
        if (args.path.endsWith('useUserRole')) return { contents: 'export const useUserRole = () => ({isAdmin:true});' };
        if (args.path.endsWith('supabaseClient')) return { contents: 'export const renovarSessao = async () => {};' };
        if (args.path.endsWith('useCurrentUser')) return { contents: 'export const currentUserName = () => "fixture";' };
        if (args.path.endsWith('usePersistentDraft')) return { contents: 'export const usePersistentDraft = () => ({});' };
        return { contents: 'const Stub=()=>null; export default Stub; export {Stub as Button, Stub as Input, Stub as Label, Stub as Textarea, Stub as Dialog, Stub as DialogContent, Stub as DialogHeader, Stub as DialogTitle, Stub as DialogFooter, Stub as PayableAttachment, Stub as PayableAttachmentUpload};' };
      });
    } }],
  });
  const filename = path.resolve('scripts/dashboard-page-fixture.cjs');
  const compiled = new Module(filename); compiled.paths = Module._nodeModulePaths(process.cwd());
  compiled._compile(built.outputFiles[0].text, filename);
  delete globalThis.__dashboardTestClient;
  const Page = compiled.exports.default;
  const slots = []; let cursor = 0, dirty = true, tree; const effects = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const dispatcher = {
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; dirty = true; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (!equal(slots[i]?.deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!equal(slots[i]?.deps, deps)) {
        const previous = slots[i]; slots[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  const internal = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const render = () => {
    const previous = internal.ReactCurrentDispatcher.current;
    const priorWindow = globalThis.window;
    globalThis.window = { location: { search: '?tab=visao' } };
    cursor = 0; dirty = false; internal.ReactCurrentDispatcher.current = dispatcher;
    try { tree = Page(); }
    finally { internal.ReactCurrentDispatcher.current = previous; globalThis.window = priorWindow; }
    effects.splice(0).forEach(fn => fn());
  };
  function find(node, predicate) {
    if (Array.isArray(node)) return node.map(x => find(x, predicate)).find(Boolean);
    if (!node || typeof node !== 'object') return null;
    return predicate(node) ? node : find(node.props?.children, predicate);
  }
  return {
    async flush() { for (let i = 0; i < 12; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); } },
    html: () => renderToStaticMarkup(find(tree, node => page === 'Financeiro' ? node.type?.name === 'FinancialOverviewCards' : node.props?.label === 'Advertências')),
    refresh: () => find(tree, node => node.props?.title === 'Recarregar os dados do Financeiro').props.onClick(),
    unmount: () => slots.forEach(slot => slot?.cleanup?.()),
  };
}

export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
