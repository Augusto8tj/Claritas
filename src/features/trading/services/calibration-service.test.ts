// src/features/trading/services/calibration-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let stored: any = null;
const setDocMock = vi.fn(async (_ref: any, data: any) => { stored = data; });
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  setDoc: (...a: any[]) => (setDocMock as any)(...a),
  getDoc: vi.fn(async () => ({ exists: () => stored !== null, data: () => stored })),
  serverTimestamp: vi.fn(() => ({ toMillis: () => Date.now() })),
}));

import { CalibrationService } from './calibration-service';

const cal = (over: any = {}) => ({
  zBtc: 1.8, zTargetMax: 1, corrMin: 0.65, horizon: 1, variant: 'A', suggestedDuration: 60, payoutAssumed: 0.8,
  verdict: 'INCONCLUSIVO', trainWinRate: 0.7, testWinRate: 0.65, n: 80, periodFrom: 1, periodTo: 2,
  symbols: ['cryBTCUSD', 'cryETHUSD'], timestamp: new Date().toISOString(), ...over,
});

describe('CalibrationService', () => {
  beforeEach(() => { stored = null; setDocMock.mockClear(); });

  it('salva e recupera uma calibração recente (sem expor lastRun)', async () => {
    await CalibrationService.save('u1', cal() as any);
    expect(setDocMock).toHaveBeenCalledTimes(1);
    const got = await CalibrationService.get('u1');
    expect(got?.verdict).toBe('INCONCLUSIVO');
    expect((got as any).lastRun).toBeUndefined();
  });

  it('calibração com mais de 14 dias => null', async () => {
    stored = cal({ timestamp: new Date(Date.now() - 15 * 86400000).toISOString() });
    expect(await CalibrationService.get('u1')).toBeNull();
  });

  it('timestamp inválido e sem lastRun => null (antes virava NaN e bloqueava para sempre)', async () => {
    stored = cal({ timestamp: undefined });
    expect(await CalibrationService.get('u1')).toBeNull();
  });

  it('timestamp ausente mas lastRun válido => aceita', async () => {
    stored = { ...cal({ timestamp: undefined }), lastRun: { toMillis: () => Date.now() } };
    expect((await CalibrationService.get('u1'))?.horizon).toBe(1);
  });

  it('save preenche timestamp quando ausente; sem usuário não faz nada', async () => {
    await CalibrationService.save('u1', cal({ timestamp: '' }) as any);
    expect(Date.parse(stored.timestamp)).not.toBeNaN();
    setDocMock.mockClear();
    await CalibrationService.save('', cal() as any);
    expect(setDocMock).not.toHaveBeenCalled();
    expect(await CalibrationService.get('')).toBeNull();
  });
});
