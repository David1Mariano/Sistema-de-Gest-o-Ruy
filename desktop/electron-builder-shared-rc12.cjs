// electron-builder-shared-rc12.cjs
// ConfiguraÃ§Ã£o exclusiva para rc.12: frontend D1 recÃ©m-compilado (dist-d1),
// arquitetura compartilhada e identidade operacional preservada.
// NÃ£o sobrescreve rc.11 (appId diferente) nem a produÃ§Ã£o.
const base = require('./electron-builder-operational.cjs');
const fs = require('node:fs');
const path = require('path');
const root = path.join(__dirname, '..');

module.exports = {
  ...base,
  // Pasta de saÃ­da separada do rc.3 anterior.
  directories: {
    output: path.join(root, 'artifacts/ruy-rc12-20261031'),
    app: path.join(root, 'desktop'),
  },
  // Inclui todos os arquivos .mjs/.cjs do desktop/ (entry points e mÃ³dulos
  // compartilhados) mais o frontend D1 recÃ©m-compilado.
  files: [
    ...base.files.flatMap(pattern =>
      pattern === '*.mjs'
        ? fs.readdirSync(__dirname).filter(name => name.endsWith('.mjs') && !/-(?:smoke|test)\.mjs$/.test(name))
        : pattern === '*.cjs'
          ? fs.readdirSync(__dirname).filter(name => name.endsWith('.cjs') && !name.startsWith('electron-builder-'))
          : [pattern]
    ),
    { from: '../server/sync-lab', to: 'server/sync-lab', filter: ['**/*.mjs', '**/*.cjs'] },
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
  nsis: {
    ...base.nsis,
    include: 'nsis-shared-shortcuts.nsh',
    createDesktopShortcut: 'always',
    artifactName: 'Sistema-Ruy-Compartilhado-0.10.0-rc.12-Setup.${ext}',
  },
};
