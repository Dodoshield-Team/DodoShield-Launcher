/**
 * Minimal uncompressed NBT (big-endian) reader/writer — enough for servers.dat.
 * Values are represented as { type, value }; compounds as { type: 10, value: { name: tag } },
 * lists as { type: 9, value: { type, value: [rawValues] } }.
 */
const T = { End: 0, Byte: 1, Short: 2, Int: 3, Long: 4, Float: 5, Double: 6, ByteArray: 7, String: 8, List: 9, Compound: 10, IntArray: 11, LongArray: 12 }

class Reader {
    constructor(buf) { this.buf = buf; this.pos = 0 }
    byte() { return this.buf.readInt8(this.pos++) }
    short() { const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v }
    int() { const v = this.buf.readInt32BE(this.pos); this.pos += 4; return v }
    long() { const v = this.buf.readBigInt64BE(this.pos); this.pos += 8; return v }
    float() { const v = this.buf.readFloatBE(this.pos); this.pos += 4; return v }
    double() { const v = this.buf.readDoubleBE(this.pos); this.pos += 8; return v }
    string() { const len = this.buf.readUInt16BE(this.pos); this.pos += 2; const s = this.buf.toString('utf8', this.pos, this.pos + len); this.pos += len; return s }
    value(type) {
        switch (type) {
            case T.Byte: return this.byte()
            case T.Short: return this.short()
            case T.Int: return this.int()
            case T.Long: return this.long()
            case T.Float: return this.float()
            case T.Double: return this.double()
            case T.ByteArray: { const n = this.int(); const a = []; for (let i = 0; i < n; i++) a.push(this.byte()); return a }
            case T.String: return this.string()
            case T.List: { const t = this.byte(); const n = this.int(); const a = []; for (let i = 0; i < n; i++) a.push(this.value(t)); return { type: t, value: a } }
            case T.Compound: {
                const o = {}
                for (;;) {
                    const t = this.byte()
                    if (t === T.End) break
                    const name = this.string()
                    o[name] = { type: t, value: this.value(t) }
                }
                return o
            }
            case T.IntArray: { const n = this.int(); const a = []; for (let i = 0; i < n; i++) a.push(this.int()); return a }
            case T.LongArray: { const n = this.int(); const a = []; for (let i = 0; i < n; i++) a.push(this.long()); return a }
            default: throw new Error('Unknown NBT tag ' + type)
        }
    }
}

class Writer {
    constructor() { this.chunks = [] }
    push(b) { this.chunks.push(b) }
    byte(v) { const b = Buffer.alloc(1); b.writeInt8(v); this.push(b) }
    short(v) { const b = Buffer.alloc(2); b.writeInt16BE(v); this.push(b) }
    int(v) { const b = Buffer.alloc(4); b.writeInt32BE(v); this.push(b) }
    long(v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); this.push(b) }
    float(v) { const b = Buffer.alloc(4); b.writeFloatBE(v); this.push(b) }
    double(v) { const b = Buffer.alloc(8); b.writeDoubleBE(v); this.push(b) }
    string(s) { const d = Buffer.from(s, 'utf8'); const b = Buffer.alloc(2); b.writeUInt16BE(d.length); this.push(b); this.push(d) }
    value(type, v) {
        switch (type) {
            case T.Byte: return this.byte(v)
            case T.Short: return this.short(v)
            case T.Int: return this.int(v)
            case T.Long: return this.long(v)
            case T.Float: return this.float(v)
            case T.Double: return this.double(v)
            case T.ByteArray: this.int(v.length); v.forEach(x => this.byte(x)); return
            case T.String: return this.string(v)
            case T.List: this.byte(v.type); this.int(v.value.length); v.value.forEach(x => this.value(v.type, x)); return
            case T.Compound:
                for (const [name, tag] of Object.entries(v)) { this.byte(tag.type); this.string(name); this.value(tag.type, tag.value) }
                this.byte(T.End); return
            case T.IntArray: this.int(v.length); v.forEach(x => this.int(x)); return
            case T.LongArray: this.int(v.length); v.forEach(x => this.long(x)); return
            default: throw new Error('Unknown NBT tag ' + type)
        }
    }
    result() { return Buffer.concat(this.chunks) }
}

/** Parse a root compound. Returns { name, value } where value is the compound object. */
exports.parse = function (buf) {
    const r = new Reader(buf)
    const type = r.byte()
    if (type !== T.Compound) throw new Error('Root tag is not a compound')
    const name = r.string()
    return { name, value: r.value(T.Compound) }
}

/** Serialize a root compound. */
exports.write = function (name, compound) {
    const w = new Writer()
    w.byte(T.Compound)
    w.string(name)
    w.value(T.Compound, compound)
    return w.result()
}

exports.Tag = T
