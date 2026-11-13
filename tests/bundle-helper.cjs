'use strict'
const path = require('node:path'), vm = require('node:vm')
exports.bundle = async (entry, mocks, globals = {}) => {
  const { rolldown } = await import('rolldown')
  const build = await rolldown({ input: path.resolve(__dirname, '..', entry), platform: 'node',
    plugins: [{ name: 'isolated-test-dependencies',
      resolveId(source, importer) {
        const key = Object.hasOwn(mocks, source) ? source : importer && source.startsWith('.') ? path.resolve(path.dirname(importer), source).replaceAll('\\','/').split('/src/')[1]?.replace(/\.(ts|tsx)$/, '') : null
        if (key && Object.hasOwn(mocks,key)) return '\0mock:' + key
      },
      load(id) { if (id.startsWith('\0mock:')) return Object.keys(mocks[id.slice(6)]).map(name => name === 'default'
        ? `export default globalThis.__mock[${JSON.stringify(id.slice(6))}].default;`
        : `export const ${name}=globalThis.__mock[${JSON.stringify(id.slice(6))}][${JSON.stringify(name)}];`).join('\n') },
    }] })
  const { output } = await build.generate({ format: 'cjs' }); await build.close()
  const exp = {}, context = { exports: exp, module: { exports: exp }, console, TextEncoder, TextDecoder, Error, TypeError, RangeError,
    setTimeout, clearTimeout, Map, Set, Uint8Array, __mock: mocks, ...globals }
  vm.runInNewContext(output[0].code, context)
  return context.module.exports
}
exports.create = initializer => {
  let state
  const set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } }
  const get = () => state
  state = initializer(set, get)
  return { getState: get, setState: set }
}
exports.deferred = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject} }
