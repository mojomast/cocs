import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {TOUCH_BUTTONS} from './touch.mjs';

test('the rendered touch cluster includes every action, including grenade', async () => {
  const file = new URL('../app/game-ui/touch-controls.tsx', import.meta.url);
  const source = await readFile(file, 'utf8');
  // Render the actual TSX without requiring a production build or a browser.
  const {outputText} = ts.transpileModule(source, {compilerOptions:{jsx:ts.JsxEmit.ReactJSX, module:ts.ModuleKind.ESNext}});
  const executable = outputText.replace(/from (["'])([^"']+)\1/g, (_, quote, specifier) =>
    `from ${quote}${specifier.startsWith('.') ? new URL(specifier, file).href : import.meta.resolve(specifier)}${quote}`);
  const {TouchControls} = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
  const props = {runtime:{current:{}}, visible:true, onLook(){}, onSwap(){}, onPause(){}};
  const html = renderToStaticMarkup(createElement(TouchControls, props));
  for (const action of TOUCH_BUTTONS) assert.ok(html.includes(`touch-button touch-${action}"`), `${action} is rendered`);
  assert.match(html, /aria-label="GRENADE"/);
  assert.equal(renderToStaticMarkup(createElement(TouchControls, {...props, visible:false})), '');
});
