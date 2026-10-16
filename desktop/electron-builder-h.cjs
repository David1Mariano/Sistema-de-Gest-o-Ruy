const base=require('./package.json').build;
module.exports={...base,appId:'br.ruy.gestao.laboratorio.h',productName:'Sistema de Gestão Ruy Lab H',
 directories:{output:'../artifacts/windows-lab-0.5.0-h1'},
 files:[...base.files,'recovery-renderer.js','!electron-builder-h.cjs'],
 extraMetadata:{ruyRevision:'H1',ruyAppId:'br.ruy.gestao.laboratorio.h'},
 nsis:{...base.nsis,artifactName:'Sistema-Gestao-Ruy-Lab-0.5.0-H1-Setup.${ext}',shortcutName:'Sistema de Gestão Ruy — Homologação H'},
};
