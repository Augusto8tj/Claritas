import { describe, it, expect } from 'vitest';
import { checkGuardrails, DEFAULT_GUARDRAILS } from './pilot-guardrails';

describe('Pilot Guardrails V13', () => {
  it('deve bloquear conta real', () => {
    const res = checkGuardrails('cryETHUSD', 'real', 1, [], 0);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('REAL bloqueada');
  });

  it('deve bloquear ativos diferentes de cryETHUSD', () => {
    const res = checkGuardrails('cryBTCUSD', 'demo', 1, [], 0);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('Apenas cryETHUSD');
  });

  it('deve bloquear se houver posição aberta', () => {
    const ops: any[] = [{ asset: 'cryETHUSD', status: 'pending', timestamp: new Date().toISOString() }];
    const res = checkGuardrails('cryETHUSD', 'demo', 1, ops, 0);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('ORDEM_ATIVA');
  });

  it('deve respeitar cooldown de perdas consecutivas', () => {
    const now = new Date();
    const ops: any[] = [
        { asset: 'cryETHUSD', status: 'lost', timestamp: now.toISOString(), initiator: 'Conselho' },
        { asset: 'cryETHUSD', status: 'lost', timestamp: now.toISOString(), initiator: 'Conselho' },
        { asset: 'cryETHUSD', status: 'lost', timestamp: now.toISOString(), initiator: 'Conselho' },
    ];
    const res = checkGuardrails('cryETHUSD', 'demo', 1, ops, 0);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('COOLDOWN');
  });
});
