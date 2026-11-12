import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { unzipEntries, isZipBytes } from './zip-reader';
import { readCandlesFromFile } from './candle-csv-import';

function crc32(buf: Uint8Array): number {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
    return (crc ^ 0xffffffff) >>> 0;
}
/** Monta um .zip válido (stored ou deflate) para os testes. */
function buildZip(files: { name: string; content: string; deflate?: boolean }[]): ArrayBuffer {
    const parts: Uint8Array[] = [], central: Uint8Array[] = [];
    let offset = 0;
    const enc = new TextEncoder();
    for (const f of files) {
        const raw = enc.encode(f.content), name = enc.encode(f.name);
        const comp = f.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
        const method = f.deflate ? 8 : 0, crc = crc32(raw);
        const lh = new Uint8Array(30 + name.length), lv = new DataView(lh.buffer);
        lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, method, true);
        lv.setUint32(14, crc, true); lv.setUint32(18, comp.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, name.length, true);
        lh.set(name, 30);
        const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
        cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, method, true);
        cv.setUint32(16, crc, true); cv.setUint32(20, comp.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
        ch.set(name, 46);
        parts.push(lh, comp); central.push(ch);
        offset += lh.length + comp.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    const all = [...parts, ...central, eocd];
    const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
    let o = 0; for (const a of all) { out.set(a, o); o += a.length; }
    return out.buffer;
}

const CSV = [
    '1780272000000000,73674.39,73685.50,73654.06,73684.43,3.76233,1780272059999999,277179.25,2892,2.24,165600.35,0',
    '1780272060000000,73684.42,73684.43,73667.45,73667.46,10.59377,1780272119999999,780479.21,979,4.62,340411.23,0',
].join('\n');

describe('zip-reader', () => {
    it('lê entradas stored e deflate', async () => {
        const e = await unzipEntries(buildZip([{ name: 'a.csv', content: 'hello' }, { name: 'b.csv', content: CSV.repeat(50), deflate: true }]));
        expect(e.map(x => x.name)).toEqual(['a.csv', 'b.csv']);
        expect(new TextDecoder().decode(e[0].data)).toBe('hello');
        expect(new TextDecoder().decode(e[1].data)).toBe(CSV.repeat(50));
    });
    it('rejeita lixo e detecta a assinatura PK', async () => {
        await expect(unzipEntries(new TextEncoder().encode('isto não é um zip').buffer as ArrayBuffer)).rejects.toThrow('inválido');
        expect(isZipBytes(new Uint8Array(buildZip([{ name: 'a', content: 'x' }])))).toBe(true);
        expect(isZipBytes(new TextEncoder().encode('1780272000000000,1'))).toBe(false);
    });
});

describe('readCandlesFromFile', () => {
    it('abre BTCUSDT-1m-2026-11-01.zip com o .csv dentro (Binance, µs)', async () => {
        const zip = buildZip([{ name: 'BTCUSDT-1m-2026-11-01.csv', content: CSV, deflate: true }]);
        const r = await readCandlesFromFile({ name: 'BTCUSDT-1m-2026-11-01.zip', arrayBuffer: async () => zip });
        expect(r.fromZip).toBe(true);
        expect(r.entries).toBe(1);
        expect(r.candles).toHaveLength(2);
        expect(new Date(r.candles[0].epoch * 1000).toISOString()).toBe('2026-06-01T00:00:00.000Z');
    });
    it('continua lendo .csv puro', async () => {
        const buf = new TextEncoder().encode(CSV).buffer as ArrayBuffer;
        const r = await readCandlesFromFile({ name: 'BTCUSDT-1m-2026-06.csv', arrayBuffer: async () => buf });
        expect(r.fromZip).toBe(false);
        expect(r.candles).toHaveLength(2);
    });
    it('zip sem csv dá erro claro', async () => {
        const zip = buildZip([{ name: 'leia-me.txt', content: 'x' }]);
        await expect(readCandlesFromFile({ name: 'x.zip', arrayBuffer: async () => zip })).rejects.toThrow('nenhum .csv');
    });
});
