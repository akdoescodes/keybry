// Serves the demo for testing on a phone: `npm run demo`, then open the printed address on the phone.
// /lib/* is the freshly built package (dist/), exactly what the GitHub Pages build ships.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.PORT) || 5173
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/\\/g, '/')
  const file = path.startsWith('/lib/')
    ? join(root, 'dist', path.slice(5))
    : join(root, 'demo', path.endsWith('/') ? path + 'index.html' : path)
  if (!file.startsWith(join(root, 'dist')) && !file.startsWith(join(root, 'demo'))) return res.writeHead(403).end()
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(body)
  } catch {
    res.writeHead(404).end('Not found')
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`\n  keybry demo\n\n  This computer:  http://localhost:${port}/`)
  for (const list of Object.values(networkInterfaces()))
    for (const a of list ?? []) if (a.family == 'IPv4' && !a.internal) console.log(`  Phone (Wi-Fi):  http://${a.address}:${port}/`)
  console.log(
    `\n  The exact Chrome numbers (VirtualKeyboard API) need HTTPS or localhost. On Android, use\n` +
      `  chrome://inspect > Port forwarding (${port} -> localhost:${port}) and open http://localhost:${port}/ on the phone.\n`,
  )
})
