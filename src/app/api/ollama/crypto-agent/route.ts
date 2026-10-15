
import { NextResponse } from 'next/server';

/**
 * GATEWAY DE INFERÊNCIA CRYPTO V4.2
 * Otimizado para baixa latência e alta seletividade.
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
