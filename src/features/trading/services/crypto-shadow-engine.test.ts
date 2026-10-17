// src/features/trading/services/crypto-shadow-engine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateDocMock = vi.fn(async () => undefined);
let pendingDocs: any[] = [];
const getDocsMock = vi.fn(async () => ({ docs: pendingDocs.map(d => ({ id: d.id, data: () => d })) }));

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/services/utils/sanitize-for-firestore', () => ({ sanitizeForFirestore: (x: any) => x }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  addDoc: vi.fn(async () => ({ id: 'new' })),
  doc: vi.fn(() => ({})),
  updateDoc: (...a: any[]) => (updateDocMock as any)(...a),
  serverTimestamp: vi.fn(() => 'ts'),
  getDocs: (...a: any[]) => (getDocsMock as any)(...a),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
}));

const baseTrade = (over: any = {}) => ({
  id: 't1', symbol: 'cryETHUSD', direction: 'CALL', contract: 'OPTIONS',
  entryPrice: 100, duration: 15, durationUnit: 's', gravityState: 'BULL_DRAG',
  rule: 'R', score: 80, confidence: 80, payoutRatio: 85, ev: 0, stake: 1,
  status: 'pending', timestamp: new Date().toISOString(),
  entryTs: Date.now() - 16_000, ...over,
});

async function freshEngine() {
  vi.resetModules();
  return (await import('./crypto-shadow-engine')).CryptoShadowEngine;
}

describe('CryptoShadowEngine.settlePending', () => {
  beforeEach(() => { updateDocMock.mockClear(); getDocsMock.mockClear(); pendingDocs = []; });

  it('liquida uma vez mesmo com chamadas concorrentes (trava de reentrada)', async () => {
    pendingDocs = [baseTrade()];
    const engine = await freshEngine();
    const onResult = vi.fn();
    await Promise.all([
      engine.settlePending('u1', () => 101, onResult),
      engine.settlePending('u1', () => 101, onResult),
      engine.settlePending('u1', () => 101, onResult),
    ]);
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0][1]).toBe(true);           // win
    expect(onResult.mock.calls[0][2]).toBeCloseTo(0.85);    // payout 85%
  });

  it('empate vira draw e não notifica estatísticas', async () => {
    pendingDocs = [baseTrade()];
    const engine = await freshEngine();
    const onResult = vi.fn();
    await engine.settlePending('u1', () => 100, onResult);
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect((updateDocMock.mock.calls[0] as any[])[1].result).toBe('draw');
    expect(onResult).not.toHaveBeenCalled();
  });

  it('marca lateSettle e o repassa ao callback', async () => {
    pendingDocs = [baseTrade({ entryTs: Date.now() - 60_000 })];
    const engine = await freshEngine();
    const onResult = vi.fn();
    await engine.settlePending('u1', () => 99, onResult);
    const trade = onResult.mock.calls[0][3];
    expect(trade.lateSettle).toBe(true);
    expect(onResult.mock.calls[0][1]).toBe(false);          // PUT/CALL: CALL com preço menor = loss
  });

  it('não relê o Firestore a cada chamada com cache vazio (TTL)', async () => {
    const engine = await freshEngine();
    await engine.settlePending('u1', () => 100, vi.fn());
    await engine.settlePending('u1', () => 100, vi.fn());
    await engine.settlePending('u1', () => 100, vi.fn());
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });

  it('não liquida antes do vencimento', async () => {
    pendingDocs = [baseTrade({ entryTs: Date.now() - 2_000 })];
    const engine = await freshEngine();
    await engine.settlePending('u1', () => 101, vi.fn());
    expect(updateDocMock).not.toHaveBeenCalled();
  });
});
