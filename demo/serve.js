// A static file server for the demo, with no dependencies: serves this
// repository (so the demo can reach dist/ and node_modules/) on port 8800, or
// the port given as the first argument.
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const port = Number(process.argv[2] || 8800)
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
}

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  let file = normalize(join(root, path))
  if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end(); return }
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html')
    const size = statSync(file).size
    const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' }
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.range || '')
    if (range) {
      const start = range[1] ? Number(range[1]) : 0
      const end = range[2] ? Number(range[2]) : size - 1
      response.writeHead(206, Object.assign(headers, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 }))
      createReadStream(file, { start, end }).pipe(response)
    } else {
      response.writeHead(200, Object.assign(headers, { 'Content-Length': size }))
      createReadStream(file).pipe(response)
    }
  } catch {
    response.writeHead(404).end()
  }
}).listen(port, () => console.log(`Demo at http://localhost:${port}/demo/`))
