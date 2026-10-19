
import { NextResponse } from 'next/server';

const VALID_CONTRACTS = ['OPTIONS', 'ACCUMULATORS', 'MULTIPLIERS'];
const VALID_ACTIONS = ['CALL', 'PUT', 'HOLD'];

/**
 * Sanitiza a opinião da IA para garantir que respeite os enums do sistema.
 */
function sanitizeOpinion(raw: any, symbol: string): any {
    let action = String(raw.action || 'HOLD').toUpperCase();
    if (action === 'RISE') action = 'CALL';
    if (action === 'FALL') action = 'PUT';
    
    if (!VALID_ACTIONS.includes(action)) {
        console.warn(`[Agent API] action inválida recebida: "${raw.action}" para ${symbol}. Forçando HOLD.`);
        action = 'HOLD';
    }

    let contract = String(raw.recommendedContract || '').toUpperCase();
    
    // Auto-correção para casos onde a IA confunde a ação com o tipo de contrato
    if (contract === 'CALL' || contract === 'PUT' || contract === 'RISE' || contract === 'FALL' || contract === 'HOLD' || contract === symbol.toUpperCase()) {
        contract = 'OPTIONS';
    }

    if (!VALID_CONTRACTS.includes(contract)) {
        console.warn(`[Agent API] recommendedContract inválido recebido: "${raw.recommendedContract}" para ${symbol}. Forçando OPTIONS.`);
        contract = 'OPTIONS';
    }

    return { ...raw, action, recommendedContract: contract };
}

export async function POST(req: Request) {
  try {
    const { systemPrompt, marketSnapshot, config } = await req.json();

    if (!config?.baseUrl) {
      return NextResponse.json({ error: 'Ollama config missing' }, { status: 400 });
    }

    const url = config.baseUrl.replace(/\/+$/, '') + '/api/generate';
    const authHeader = config.apiKey ? `Bearer ${config.apiKey}` : '';

    const prompt = `
      ${systemPrompt}
      
      DADOS DO MERCADO ATUAL:
      ${JSON.stringify(marketSnapshot, null, 2)}
      
      REGRAS DE RESPOSTA (Etapa 11):
      1. Se rule for 'LEADLAG_SLINGSHOT', a regra do RSI é secundária; siga o Bitcoin.
      2. Se for 'OPT_REV', a regra do RSI é ABSOLUTA: <35 COMPRA, >65 VENDA.
      
      Campos do snapshot: mom5/mom15 = variação em ATRs; bbPos = posição nas bandas (0-1); bwPct = percentil largura; er = eficiência; slingshot = arraste líder.

      Responda OBRIGATORIAMENTE apenas em JSON válido.
      Não inclua markdown ou explicações fora do objeto.
      Campos obrigatórios:
      "action": "CALL", "PUT" ou "HOLD".
      "confidence": número inteiro 0-100.
      "recommendedContract": "OPTIONS", "ACCUMULATORS" ou "MULTIPLIERS".
      "reasoning": justificativa técnica curta.
      "vetoTriggered": boolean.
    `;

    console.log(`[Agent API] Iniciando requisição para: ${url} (Modelo: ${config.model})`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      signal: AbortSignal.timeout(13000),
      body: JSON.stringify({
        model: config.model,
        prompt: prompt,
        stream: false,
        format: "json",
        options: {
          temperature: 0.1,
          num_predict: 300
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Agent API] Erro na resposta do Ollama (HTTP ${response.status}):`, errorText);
      return NextResponse.json({ error: `Ollama error: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    let content = data.response;
    
    content = content.replace(/```json|```/g, "").trim();
    
    let parsedOpinion: any = {};
    try {
        parsedOpinion = JSON.parse(content);
        parsedOpinion = sanitizeOpinion(parsedOpinion, marketSnapshot.symbol);
    } catch (parseError: any) {
        return NextResponse.json({ 
            error: "Falha ao processar resposta estruturada da IA local.",
            rawResponse: content 
        }, { status: 500 });
    }

    const evalDurationMs = (data.eval_duration || 0) / 1_000_000;
    const tokensPerSecond = (data.eval_count && evalDurationMs > 0) 
        ? (data.eval_count / (evalDurationMs / 1000)) 
        : 0;

    return NextResponse.json({
        opinion: parsedOpinion,
        metrics: {
            tokensPerSecond: Math.round(tokensPerSecond),
            totalTokens: data.eval_count || 0,
            loadDuration: Math.round((data.load_duration || 0) / 1_000_000)
        }
    });

  } catch (error: any) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        return NextResponse.json({ error: 'timeout' }, { status: 504 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
