import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const modulesDir = path.resolve(import.meta.dirname, '../src/coin-modules')

const parseModule = (name: string) => ts.createSourceFile(
  name,
  fs.readFileSync(path.join(modulesDir, name), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
)

const expectedCoinIds = [
  'bitcoin',
  'bitcoin2',
  'bitcoincashii',
  'firo',
  'btgs',
  'capstash',
  'hypercoin',
  'mydogecoin',
  'pepecoin',
  'kerrigan',
  'scash',
  'litecoinii',
  'neoxa',
  'terracoin',
  'junkcoin',
  'raptoreum',
  'zano',
  'epic',
  'quai',
  'pearl',
  'qubic',
  'kaspa',
  'ckb',
]

const specialRoutes: Record<string, string> = {
  zano: 'zano-wallet',
  epic: 'epic-wallet',
  quai: 'quai-js',
  pearl: 'pearl-wallet',
  qubic: 'qubic-js',
  kaspa: 'kaspa-wasm',
  ckb: 'ckb-lumos',
}

const registryModuleIds = () => {
  const source = parseModule('index.ts')
  const defaultImports = new Map<string, string>()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.name) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    defaultImports.set(statement.importClause.name.text, path.basename(statement.moduleSpecifier.text))
  }

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'coinModules') continue
      if (!declaration.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) continue
      return declaration.initializer.elements.map((element) => {
        assert.ok(ts.isIdentifier(element), 'coinModules entries must be imported identifiers')
        const id = defaultImports.get(element.text)
        assert.ok(id, `coinModules import not found: ${element.text}`)
        return id
      })
    }
  }
  throw new Error('coinModules array was not found')
}

const moduleDefinition = (coinId: string) => {
  const source = parseModule(`${coinId}.ts`)
  let definition: { id: string; nativeRoute: string } | undefined
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'defineCoinModule'
      && node.arguments[0]
      && ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const idProperty = node.arguments[0].properties.find((property) => (
        ts.isPropertyAssignment(property)
        && ts.isIdentifier(property.name)
        && property.name.text === 'id'
      ))
      assert.ok(idProperty && ts.isPropertyAssignment(idProperty), `${coinId} must declare id`)
      assert.ok(ts.isStringLiteral(idProperty.initializer), `${coinId} id must be a string literal`)
      const routeArgument = node.arguments[1]
      definition = {
        id: idProperty.initializer.text,
        nativeRoute: routeArgument && ts.isStringLiteral(routeArgument)
          ? routeArgument.text
          : `${idProperty.initializer.text}-wallet`,
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!definition) throw new Error(`defineCoinModule call was not found: ${coinId}`)
  return definition
}

test('the modular wallet registry contains every supported coin exactly once', () => {
  const ids = registryModuleIds()
  assert.deepEqual(ids, expectedCoinIds)
  assert.equal(new Set(ids).size, expectedCoinIds.length)
  assert.equal(ids.length, 23)
})

test('every coin module owns its matching definition and native route', () => {
  for (const coinId of registryModuleIds()) {
    const definition = moduleDefinition(coinId)
    assert.equal(definition.id, coinId, coinId)
    assert.equal(definition.nativeRoute, specialRoutes[coinId] ?? `${coinId}-wallet`, coinId)
  }
})
