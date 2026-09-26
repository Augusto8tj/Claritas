
import { NextResponse } from 'next/server';

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
      
      REGRAS:
      - Responda APENAS em JSON.
      - Não inclua explicações fora do JSON.
    `;

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
          temperature: 0.2
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `Ollama error: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    let content = data.response;
    
    // Tenta limpar o JSON se vier com markdown
    content = content.replace(/```json|```/g, "").trim();
    
    return NextResponse.json(JSON.parse(content));

  } catch (error: any) {
    console.error('[Agent API Error]:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
