import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { systemPrompt, marketSnapshot, config } = await req.json();

    if (!config?.baseUrl) {
      return NextResponse.json({ error: 'Ollama config missing' }, { status: 400 });
    }

    const url = config.baseUrl.replace(/\/+$/, '') + '/api/generate';
    const authHeader = config.apiKey ? `Bearer ${config.apiKey}` : '';

    // PROMPT REFORÇADO COM SCHEMA EXPLÍCITO PARA DIAGNÓSTICO
    const prompt = `
      ${systemPrompt}
      
      DADOS DO MERCADO ATUAL:
      ${JSON.stringify(marketSnapshot, null, 2)}
      
      REGRAS DE RESPOSTA:
      - Responda OBRIGATORIAMENTE apenas em JSON válido.
      - Não inclua markdown (como \`\`\`json) ou explicações fora do objeto.
      - Campos obrigatórios: "action" (CALL/PUT/HOLD), "confidence" (0-100), "recommendedContract", "reasoning", "vetoTriggered" (boolean).
      - Seja ULTRA-CONCISO para economizar tokens.
    `;

    console.log(`[Agent API] Iniciando requisição para: ${url} (Modelo: ${config.model})`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify({
        model: config.model,
        prompt: prompt,
        stream: false,
        format: "json",
        options: {
          temperature: 0.1 // Reduzido para maior consistência no formato JSON
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
    
    // DIAGNÓSTICO 1: Resposta crua do Ollama
    console.log(`[Agent API] RESPOSTA CRUA DO OLLAMA (${config.model}):`, content);

    // Limpeza de Markdown redundante (alguns modelos ignoram o parâmetro format: json)
    content = content.replace(/```json|```/g, "").trim();
    
    let parsedOpinion = {};
    try {
        parsedOpinion = JSON.parse(content);
        console.log(`[Agent API] Sucesso no parse da opinião:`, parsedOpinion);
    } catch (parseError: any) {
        // DIAGNÓSTICO 2: Falha detalhada no parse
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
    console.error('[Agent API Error]:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
