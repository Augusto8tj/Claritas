import { NextResponse } from 'next/server';

/**
 * GATEWAY DE INFERÊNCIA CRYPTO V4.2
 * Otimizado para baixa latência e alta seletividade.
 * V5.4: Implementação de allowlist para segurança de host.
 */

const VALID_CONTRACTS = ['OPTIONS', 'ACCUMULATORS', 'MULTIPLIERS'];
const VALID_ACTIONS = ['CALL', 'PUT', 'HOLD'];

function sanitizeOpinion(raw: any, symbol: string): any {
    let action = String(raw.action || 'HOLD').toUpperCase();
    if (action === 'RISE') action = 'CALL';
    if (action === 'FALL') action = 'PUT';
    
    if (!VALID_ACTIONS.includes(action)) action = 'HOLD';

    let contract = String(raw.recommendedContract || '').toUpperCase();
    if (contract === 'CALL' || contract === 'PUT' || contract === symbol.toUpperCase()) {
        contract = 'OPTIONS';
    }

    if (!VALID_CONTRACTS.includes(contract)) contract = 'OPTIONS';

    return { 
        ...raw, 
        action, 
        recommendedContract: contract,
        confidence: Math.min(100, Math.max(0, Number(raw.confidence) || 0))
    };
}

export async function POST(req: Request) {
  try {
    const { systemPrompt, marketSnapshot, config } = await req.json();

    if (!config?.baseUrl) return NextResponse.json({ error: 'Config missing' }, { status: 400 });

    // ETAPA 3: Validação de Host contra allowlist configurada
    const allowedHosts = (process.env.OLLAMA_ALLOWED_HOSTS || "").split(',').map(h => h.trim()).filter(Boolean);
    try {
        const urlObj = new URL(config.baseUrl);
        if (allowedHosts.length > 0 && !allowedHosts.includes(urlObj.host)) {
            console.error(`[Agent API] Acesso negado para host: ${urlObj.host}`);
            return NextResponse.json({ 
                error: 'Host não autorizado. Adicione o domínio na variável OLLAMA_ALLOWED_HOSTS.' 
            }, { status: 400 });
        }
    } catch (e) {
        return NextResponse.json({ error: 'URL do Gateway Ollama inválida.' }, { status: 400 });
    }

    const url = config.baseUrl.replace(/\/+$/, '') + '/api/generate';
    
    // AbortController estrito para garantir Failover T2T
    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      signal: AbortSignal.timeout(14000), // 14s timeout para o agente individual
      body: JSON.stringify({
        model: config.model,
        prompt: `${systemPrompt}\n\nSNAPSHOT ATUAL: ${JSON.stringify(marketSnapshot)}\n\nResponda APENAS em JSON válido.`,
        stream: false,
        format: "json",
        options: { temperature: 0.1, num_predict: 250 }
      })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    let content = data.response.replace(/```json|```/g, "").trim();
    
    const parsedOpinion = sanitizeOpinion(JSON.parse(content), marketSnapshot.symbol);

    return NextResponse.json({
        opinion: parsedOpinion,
        metrics: {
            tps: Math.round((data.eval_count || 0) / ((data.eval_duration || 1) / 1e9)),
            totalTokens: data.eval_count || 0
        }
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.name === 'TimeoutError' ? 504 : 500 });
  }
}
