// src/lib/ollama-host-guard.ts
/**
 * @fileOverview ETAPA 29 — proteção contra SSRF nas chamadas servidor→Ollama (rotas /api/ollama/* e server actions).
 * Regras (fail-closed):
 *  - só http/https, sem usuário:senha na URL, sem query/hash;
 *  - se OLLAMA_ALLOWED_HOSTS (lista separada por vírgula, "host" ou "host:porta") estiver definida: SÓ esses hosts passam;
 *  - se estiver vazia: só o Ollama local padrão (localhost:11434, 127.0.0.1:11434, [::1]:11434);
 *  - metadados de nuvem (169.254.169.254, metadata.google.internal, ...) são SEMPRE bloqueados, mesmo na lista.
 * LIMITAÇÃO: a checagem é por nome/host textual. Um host permitido cujo DNS passe a apontar para a rede interna (DNS rebinding) não é
 * detectado aqui; por isso mantenha na lista apenas domínios que você controla.
 */
export interface GuardResult { ok: boolean; url?: string; host?: string; error?: string }

const LOCAL_DEFAULT = ['localhost:11434', '127.0.0.1:11434', '[::1]:11434'];
const ALWAYS_BLOCKED = ['169.254.169.254', 'metadata.google.internal', 'metadata', '100.100.100.200', 'fd00:ec2::254', '[fd00:ec2::254]'];

export function parseAllowlist(env?: string | null): string[] {
    return (env ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
}

export function validateOllamaBaseUrl(baseUrl: unknown, allowedEnv: string | undefined | null = process.env.OLLAMA_ALLOWED_HOSTS): GuardResult {
    if (typeof baseUrl !== 'string' || baseUrl.length === 0 || baseUrl.length > 300) return { ok: false, error: 'URL do Ollama ausente ou longa demais.' };
    let u: URL;
    try { u = new URL(baseUrl.trim()); } catch { return { ok: false, error: 'URL do Ollama inválida.' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'Somente http/https são permitidos.' };
    if (u.username || u.password) return { ok: false, error: 'URL com usuário/senha não é permitida.' };
    if (u.search || u.hash) return { ok: false, error: 'URL base não pode ter query nem fragmento.' };
    const host = u.host.toLowerCase(), hostname = u.hostname.toLowerCase();
    if (ALWAYS_BLOCKED.includes(hostname) || ALWAYS_BLOCKED.includes(host)) return { ok: false, error: 'Host bloqueado (metadados de nuvem).' };
    const allow = parseAllowlist(allowedEnv);
    const ok = allow.length > 0 ? (allow.includes(host) || allow.includes(hostname)) : LOCAL_DEFAULT.includes(host);
    if (!ok) {
        return { ok: false, host, error: allow.length > 0
            ? `Host "${host}" não está em OLLAMA_ALLOWED_HOSTS.`
            : `Host "${host}" não autorizado. Defina OLLAMA_ALLOWED_HOSTS (ex.: "${host}") no servidor; sem a variável só o Ollama local (localhost:11434) é aceito.` };
    }
    const path = u.pathname.replace(/\/+$/, '');
    return { ok: true, host, url: `${u.protocol}//${u.host}${path}` };
}
