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
      
      REGRAS DE RESPOSTA:

      Responda OBRIGATORIAMENTE apenas em JSON válido.
      Não inclua markdown (como \`\`\`json) ou explicações fora do objeto.
      Campos obrigatórios e seus valores EXATOS permitidos:
      "action": EXATAMENTE um de "CALL", "PUT", "HOLD" (nunca outro valor).
      "confidence": número inteiro de 0 a 100.
      "recommendedContract": EXATAMENTE um de "OPTIONS", "ACCUMULATORS", "MULTIPLIERS"
      (NUNCA o nome do ativo, NUNCA "CALL"/"PUT"/"HOLD" — este campo descreve o TIPO
      de contrato, não a direção da operação).
      "reasoning": string curta.
      "vetoTriggered": boolean.
      Exemplo de resposta válida: {"action":"CALL","confidence":78,"recommendedContract":"MULTIPLIERS","reasoning":"RSI em sobrevenda com volume crescente.","vetoTriggered":false}
      Seja ULTRA-CONCISO para economizar tokens.
    `;

    console.log(`[Agent API] Tamanho do prompt: ${prompt.length} caracteres.`);
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
    
    console.log(`[Agent API] RESPOSTA CRUA DO OLLAMA (${config.model}):`, content);

    content = content.replace(/```json|```/g, "").trim();
    
    let parsedOpinion: any = {};
    try {
        parsedOpinion = JSON.parse(content);
        // SANITIZAÇÃO
        parsedOpinion = sanitizeOpinion(parsedOpinion, marketSnapshot.symbol);
        console.log(`[Agent API] Sucesso no parse da opinião:`, parsedOpinion);
    } catch (parseError: any) {
        console.error(`[Agent API] FALHA CRÍTICA NO PARSE DO JSON!`);
        console.error(`Texto que falhou: "${content}"`);
        console.error(`Erro técnico:`, parseError.message);
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
        console.error('[Agent API] Timeout aguardando o Ollama (13s)');
        return NextResponse.json({ error: 'timeout' }, { status: 504 });
    }
    console.error('[Agent API Error]:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
