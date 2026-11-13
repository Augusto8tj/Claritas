import { describe, it, expect } from 'vitest';
import { validateOllamaBaseUrl, parseAllowlist } from '../ollama-host-guard';

describe('ollama-host-guard (anti-SSRF, fail-closed)', () => {
    it('sem allowlist: só o Ollama local padrão', () => {
        expect(validateOllamaBaseUrl('http://localhost:11434', '').ok).toBe(true);
        expect(validateOllamaBaseUrl('http://127.0.0.1:11434/', undefined).url).toBe('http://127.0.0.1:11434');
        expect(validateOllamaBaseUrl('https://meu-tunel.ngrok-free.dev', '').ok).toBe(false);
        expect(validateOllamaBaseUrl('https://meu-tunel.ngrok-free.dev', '').error).toContain('OLLAMA_ALLOWED_HOSTS');
        expect(validateOllamaBaseUrl('http://localhost:8080', '').ok).toBe(false);
    });
    it('com allowlist: só os hosts listados (host ou host:porta), sem normalização enganosa', () => {
        const env = 'meu-tunel.ngrok-free.dev, localhost:11434';
        const r = validateOllamaBaseUrl('https://MEU-TUNEL.ngrok-free.dev/api/', env);
        expect(r.ok).toBe(true); expect(r.url).toBe('https://meu-tunel.ngrok-free.dev/api');
        expect(validateOllamaBaseUrl('http://127.0.0.1:11434', env).ok).toBe(false);
        expect(validateOllamaBaseUrl('https://meu-tunel.ngrok-free.dev.evil.com', env).ok).toBe(false);
        expect(validateOllamaBaseUrl('https://evil.com/@meu-tunel.ngrok-free.dev', env).ok).toBe(false);
    });
    it('bloqueia metadados de nuvem sempre, mesmo se listados', () => {
        expect(validateOllamaBaseUrl('http://169.254.169.254', '169.254.169.254').ok).toBe(false);
        expect(validateOllamaBaseUrl('http://metadata.google.internal', 'metadata.google.internal').ok).toBe(false);
    });
    it('rejeita esquemas, credenciais, query, fragmentos e entradas inválidas', () => {
        const env = 'localhost:11434';
        for (const u of ['file:///etc/passwd', 'ftp://localhost:11434', 'http://user:pw@localhost:11434', 'http://localhost:11434?x=1', 'http://localhost:11434#a', 'não é url', '', 'x'.repeat(400)]) expect(validateOllamaBaseUrl(u, env).ok).toBe(false);
        for (const u of [undefined, null, 5, {}, []]) expect(validateOllamaBaseUrl(u as any, env).ok).toBe(false);
    });
    it('parseAllowlist', () => { expect(parseAllowlist(' A.com , b:1,, ')).toEqual(['a.com', 'b:1']); expect(parseAllowlist(undefined)).toEqual([]); });
});
