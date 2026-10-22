// src/features/trading/services/pilot-guardrails.test.ts
import { describe, it, expect } from 'vitest';
import { parseDurationToSeconds } from './pilot-guardrails';

describe('Pilot Guardrails - Duração e Segurança', () => {
  it('analisa durações complexas corretamente', () => {
    expect(parseDurationToSeconds("15s")).toBe(15);
    expect(parseDurationToSeconds("1m")).toBe(60);
    expect(parseDurationToSeconds("2h")).toBe(7200);
    expect(parseDurationToSeconds("1d")).toBe(86400);
    expect(parseDurationToSeconds("5t")).toBe(5); // Ticks em 1s
  });
  
  it('retorna null para formatos inválidos ou vazios', () => {
    expect(parseDurationToSeconds("abc")).toBe(null);
    expect(parseDurationToSeconds("")).toBe(null);
    expect(parseDurationToSeconds(null as any)).toBe(null);
  });

  it('ignora durações com unidades desconhecidas', () => {
      expect(parseDurationToSeconds("10x")).toBe(null);
  });
});
