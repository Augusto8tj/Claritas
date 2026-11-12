// src/features/trading/services/zip-reader.ts
/**
 * @fileOverview ETAPA 23 — LEITOR MÍNIMO DE ZIP (sem dependências), para abrir os .zip do Binance Vision direto no navegador.
 * Suporta entradas "stored" (0) e "deflate" (8) — as únicas que o Binance usa. Lê pelo diretório central (confiável mesmo
 * com data descriptor). Não suporta ZIP64, criptografia nem arquivos multi-parte. Descompressão via DecompressionStream
 * ('deflate-raw'), disponível nos navegadores atuais e no Node >= 18.
 */

export interface ZipEntry { name: string; data: Uint8Array; }

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não suporta DecompressionStream: extraia o .zip e selecione o .csv.');
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function isZipBytes(b: Uint8Array): boolean {
    return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

export async function unzipEntries(buf: ArrayBuffer): Promise<ZipEntry[]> {
    const bytes = new Uint8Array(buf);
    const view = new DataView(buf);
    // End Of Central Directory: assinatura 0x06054b50, procurada de trás para frente
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
        if (u32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Arquivo .zip inválido (diretório central não encontrado).');
    const count = u16(view, eocd + 10), cdOffset = u32(view, eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('ZIP64 não suportado: extraia o .zip e selecione o .csv.');
    const out: ZipEntry[] = [];
    let p = cdOffset;
    const dec = new TextDecoder();
    for (let k = 0; k < count; k++) {
        if (u32(view, p) !== 0x02014b50) throw new Error('Arquivo .zip corrompido (entrada do diretório central inválida).');
        const method = u16(view, p + 10), compSize = u32(view, p + 20);
        const nameLen = u16(view, p + 28), extraLen = u16(view, p + 30), commentLen = u16(view, p + 32), localOffset = u32(view, p + 42);
        const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
        p += 46 + nameLen + extraLen + commentLen;
        if (name.endsWith('/')) continue; // diretório
        if (u32(view, localOffset) !== 0x04034b50) throw new Error(`Arquivo .zip corrompido (cabeçalho local de ${name}).`);
        const start = localOffset + 30 + u16(view, localOffset + 26) + u16(view, localOffset + 28);
        const raw = bytes.subarray(start, start + compSize);
        if (method === 0) out.push({ name, data: raw.slice() });
        else if (method === 8) out.push({ name, data: await inflateRaw(raw) });
        else throw new Error(`Método de compressão ${method} não suportado em ${name}.`);
    }
    return out;
}
