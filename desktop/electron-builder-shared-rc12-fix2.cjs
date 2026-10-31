// electron-builder-shared-rc12-fix2.cjs
// rc.12 FINAL: frontend D1 recém-compilado (payment-proof correction included),
// shared architecture, operational identity preserved.
// Nova pasta de saída para não sobrescrever rc.12 anterior (16:41) nem rc.11.
const base = require('./electron-builder-operational.cjs');
const fs = require('node:fs');
const path = require('path');
const root = path.join(__dirname, '..');

module.exports = {
  ...base,
  directories: {
    output: path.join(root, 'artifacts/ruy-rc12-fix-20261031b'),
    app: path.join(root, 'desktop'),
  },
  files: [
    ...base.files.flatMap(pattern =>
      pattern === '*.mjs'
        ? fs.readdirSync(__dirname).filter(name => name.endsWith('.mjs') && !/-(?:smoke|test)\.mjs$/.test(name))
        : pattern === '*.cjs'
          ? fs.readdirSync(__dirname).filter(name => name.endsWith('.cjs') && !name.startsWith('electron-builder-'))
          : [pattern]
    ),
    { from: '../server/sync-lab', to: 'server/sync-lab', filter: ['**/*.mjs', '**/*.cjs'] },
    { from: '../server/central', to: 'server/central', filter: ['public-discovery.mjs'] },
    'dist-d1/**/*',
    'central-endpoint.json',
    'central-endpoint.mjs',
    'nsis-shared-shortcuts.nsh',
  ],
  extraMetadata: {
    ...base.extraMetadata,
    main: 'windows-operational-entry.cjs',
    version: '0.10.0-rc.12',
    ruyRelease: 'RUY-RC12-EXCLUSAO-GASTOS-HOMOLOGACAO',
    ruySharedLab: true,
    ruySharedClientDefault: true,
    ruyAuthentication: 'user-session',
    centralEndpoint: 'https://quill-brunt-splinter.ngrok-free.dev',
    discoveryPublicKey: 'MCowBQYDK2VwAyEAil6lLl/9QGYKXWtR+YIAXauamsYZFqm6UKUfuN5wfqI=',
    deploymentId: 'ca47adbb-67a8-4459-b890-78cad643a615',
  },
  // NSIS identity check: appId herda br.ruy.gestao.windows.operacional (operational.cjs),
  // guid 75c7b9b8-6d06-4bf1-89d1-4e566b45c050. rc.11 usa outro artifact folder
  // (multicomputador-0.10.0-rc.11-20261030) e não conflita.
  nsis: {
    ...base.nsis,
    include: 'nsis-shared-shortcuts.nsh',
    createDesktopShortcut: 'always',
    artifactName: 'Sistema-Ruy-Compartilhado-0.10.0-rc.12-Setup.${ext}',
  },
};