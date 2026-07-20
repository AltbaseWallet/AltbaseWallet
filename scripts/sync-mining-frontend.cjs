const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = path.join(root, 'modules', 'mining', 'frontend')
const destination = path.join(root, 'modules', 'mining', 'dist', 'frontend')

if (!fs.existsSync(path.join(source, 'index.html'))) {
  throw new Error(`Mining frontend source is missing: ${source}`)
}

const html = fs.readFileSync(path.join(source, 'index.html'), 'utf8')
const styles = fs.readFileSync(path.join(source, 'styles.css'), 'utf8')
const lucide = fs.readFileSync(path.join(source, 'vendor', 'lucide.js'), 'utf8')
const app = fs.readFileSync(path.join(source, 'app.js'), 'utf8')
for (const [name, content] of [['Lucide', lucide], ['Mining application', app]]) {
  if (/<\/script/i.test(content)) throw new Error(`${name} source cannot be safely embedded in the Mining HTML document`)
}
if (/<\/style/i.test(styles)) throw new Error('Mining styles cannot be safely embedded in the Mining HTML document')

const bundled = html
  .replace('<link rel="stylesheet" href="styles.css" />', `<style>\n${styles}\n</style>`)
  .replace('<script src="vendor/lucide.js"></script>', `<script>\n${lucide}\n</script>`)
  .replace('<script src="app.js"></script>', `<script>\n${app}\n</script>`)
if (bundled === html || /(?:src|href)="(?:app\.js|styles\.css|vendor\/lucide\.js)"/.test(bundled)) {
  throw new Error('Mining frontend bundling did not replace every local subresource')
}

fs.rmSync(destination, { recursive: true, force: true })
fs.mkdirSync(destination, { recursive: true })
fs.writeFileSync(path.join(destination, 'index.html'), bundled, 'utf8')
const assetSource = path.join(source, 'assets')
if (fs.existsSync(assetSource)) {
  fs.cpSync(assetSource, path.join(destination, 'assets'), { recursive: true })
}
console.log(`Mining frontend synchronized with local assets: ${destination}`)
