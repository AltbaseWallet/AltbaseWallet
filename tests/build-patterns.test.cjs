'use strict'
const {test} = require('node:test')
const assert = require('node:assert/strict')
const {spawnSync} = require('node:child_process')
const {minimatch, Minimatch} = require('minimatch')

test('patched build matcher retains package inclusion, exclusion and Windows path behavior', () => {
  for (const [file, pattern, expected] of [
    ['dist/assets/app.js', 'dist/**/*', true],
    ['dist/assets/app.js', 'electron/**/*', false],
    ['electron/coin-sdks/zcash.cjs', 'electron/coin-sdks/**/*', true],
    ['resources/coin-plugins/tron/altbase_tron.dll', '**/*.{so,dll}', true],
    ['resources/coin-plugins/tron/manifest.json', '**/*.{so,dll}', false],
  ]) assert.equal(minimatch(file, pattern), expected, file)
  assert.equal(new Minimatch('C:/wallet/**/*.dll', {windowsPathsNoEscape:true}).match('C:/wallet/tron/module.dll'), true)
})

test('adversarial glob preprocessing completes with bounded memory and execution time', () => {
  const result = spawnSync(process.execPath, ['--max-old-space-size=96', '-e', `
    const {Minimatch}=require('minimatch');
    for(const [splits,options] of [
      [12,{optimizationLevel:2}],
      [48,{optimizationLevel:2,braceExpandMax:128}],
    ]) {
      const pattern='a/**/../'.repeat(splits)+'missing';
      const matcher=new Minimatch(pattern,options);
      if(matcher.match('unrelated/file')!==false)process.exit(2);
    }
  `], {cwd:require('node:path').resolve(__dirname,'..'), timeout:4000, encoding:'utf8'})
  assert.equal(result.error, undefined, 'Amplified glob preprocessing must finish within four seconds')
  assert.equal(result.status, 0, result.stderr)
})
