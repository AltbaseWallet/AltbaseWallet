type BrowserBuffer = Uint8Array & {
  __browserBuffer: true
  toString: (encoding?: 'hex' | 'utf8' | 'utf-8') => string
}

const toArrayBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

const makeBuffer = (bytes: Uint8Array): BrowserBuffer => {
  const buffer = new Uint8Array(toArrayBuffer(bytes)) as BrowserBuffer
  Object.defineProperty(buffer, '__browserBuffer', { value: true })
  buffer.toString = (encoding: 'hex' | 'utf8' | 'utf-8' = 'utf8') => {
    if (encoding === 'hex') {
      return Array.from(buffer)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
    }
    return new TextDecoder().decode(buffer)
  }
  return buffer
}

const bufferFrom = (input: ArrayLike<number> | ArrayBuffer | string, encoding: 'hex' | 'utf8' | 'utf-8' = 'utf8') => {
  if (typeof input === 'string') {
    if (encoding === 'hex') {
      const bytes = input.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []
      return makeBuffer(Uint8Array.from(bytes))
    }
    return makeBuffer(new TextEncoder().encode(input))
  }

  if (input instanceof ArrayBuffer) return makeBuffer(new Uint8Array(input))
  return makeBuffer(Uint8Array.from(input))
}

const bufferPolyfill = {
  from: bufferFrom,
  isBuffer(input: unknown) {
    return Boolean(input && typeof input === 'object' && '__browserBuffer' in input)
  },
}

const globalScope = globalThis as { Buffer?: unknown }
if (!globalScope.Buffer) {
  globalScope.Buffer = bufferPolyfill
}
