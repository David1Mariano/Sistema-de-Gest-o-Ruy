import { build } from 'esbuild';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';

// Compile and render the production JSX, not a replica of its markup.
export async function renderComponent(relativePath) {
  const filename = fileURLToPath(new URL('./dashboard-render-harness.cjs', import.meta.url));
  const result = await build({
    stdin: { contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import Component from ${JSON.stringify(relativePath)}; export default props => renderToStaticMarkup(React.createElement(Component, props));`, resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    mainFields: ['module', 'main'], external: ['react', 'react-dom/server', 'react/jsx-runtime'],
  });
  const compiled = new Module(filename);
  compiled.paths = Module._nodeModulePaths(process.cwd());
  compiled._compile(result.outputFiles[0].text, filename);
  return compiled.exports.default;
}

export function cardText(html, label) {
  const plain = html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, '|').replace(/\|+/g, '|');
  const parts = plain.split('|');
  return parts[parts.indexOf(label) + 1];
}
