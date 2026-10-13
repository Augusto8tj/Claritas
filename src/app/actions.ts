// /src/app/actions.ts
"use server";

import {
  financialChatbotInsights,
} from "@/ai/flows/financial-chatbot-insights";
import type { FinancialChatbotInsightsInput, OllamaConfig } from "@/lib/types";
import WebSocket from 'ws';
import { generateFinancialInsights } from "@/ai/flows/financial-insights-flow";

const NEW_DERIV_APP_ID = "34lwuJiPbEzxjgEdnEhbX";

/**
 * Obtém uma URL de WebSocket autenticada via OTP (novo fluxo Options API).
 */
export async function getDerivWebSocketUrl(token: string, accountId: string): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const response = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accountId}/otp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Deriv-App-ID': NEW_DERIV_APP_ID,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsedError;
      try {
        parsedError = JSON.parse(errorText);
      } catch (e) {
        parsedError = { message: errorText };
      }
      return { 
        success: false, 
        error: `Erro API Deriv (HTTP ${response.status}): ${parsedError.message || parsedError.error?.message || 'Falha ao obter OTP'}` 
      };
    }

    const data = await response.json();
    const url = data.data?.url || data.url;
    
    if (!url) {
      return { success: false, error: "Resposta da API não contém a URL do WebSocket." };
    }

    return { success: true, url };
  } catch (e: any) {
    console.error("[Action Error] getDerivWebSocketUrl:", e);
    return { success: false, error: e.message || "Erro de rede ao solicitar OTP." };
  }
}

export async function getChatbotInsightsResponse(data: FinancialChatbotInsightsInput & { userId: string, geminiKey?: string }) {
  try {
    if (data.geminiKey) {
        process.env.GEMINI_API_KEY = data.geminiKey;
    }
    
    const result = await financialChatbotInsights(data);
    return { success: result.response };
  } catch (e: any) {
    console.error("[Action Error] getChatbotInsightsResponse:", e);
    return { error: e.message || "Desculpe, não consegui processar isso. Por favor, tente novamente." };
  }
}

/**
 * Interface para chamadas ao Ollama Studio Local com timeout e tratamento de erro robusto.
 */
export async function getOllamaResponse(config: OllamaConfig, query: string, history: any[]): Promise<{ success?: string; error?: string; metadata?: any }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

  try {
    const url = config.baseUrl.replace(/\/+$/, '') + '/api/chat';
    const authHeader = config.apiKey?.startsWith('Bearer ') ? config.apiKey : `Bearer ${config.apiKey}`;

    const headers = {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true'
    };

    const payload = {
      model: config.model,
      messages: [...history, { role: 'user', content: query }],
      stream: false,
      keep_alive: config.keepAlive === "-1" ? -1 : config.keepAlive,
      options: {
        temperature: config.temperature
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      return { error: `Erro na IA Local (Ollama): ${errorText}` };
    }

    const data = await response.json();
    return { 
      success: data.message?.content || "(Sem resposta do Ollama)",
      metadata: data
    };
  } catch (e: any) {
    clearTimeout(timeoutId);
    console.error("[Action Error] getOllamaResponse:", e);
    const isTimeout = e.name === 'AbortError';
    return { error: isTimeout ? "A IA demorou muito a responder (Timeout)." : "Falha ao conectar com o gateway da IA Local." };
  }
}

/**
 * Executa uma bateria institucional de benchmark (Velocidade, QI Financeiro e Contexto)
 */
export async function runOllamaBenchmark(config: OllamaConfig, testType: 'speed' | 'intelligence' | 'context' = 'speed'): Promise<{ success: boolean; error?: string; metrics?: any }> {
    let query = "";
    
    if (testType === 'speed') {
        query = "Explique brevemente a importância do planejamento financeiro em 2 frases.";
    } else if (testType === 'intelligence') {
        query = `Analise a seguinte série de preços para o Volatility 100 Index: [102.5, 101.8, 103.2, 104.5, 103.8, 105.2, 106.1]. 
        Determine a tendência e sugira uma operação. Responda estritamente em JSON: {"decision": "BUY"|"SELL", "confidence": number, "logic": "string"}`;
    } else {
        const longReport = "RELATÓRIO FINANCEIRO ANUAL CLARITAS\n".repeat(200);
        query = `${longReport}\n\nPergunta de Stress: Qual o nome do projeto mencionado no início deste documento? Responda em uma palavra.`;
    }
    
    try {
        const result = await getOllamaResponse(config, query, []);
        
        if (result.error) throw new Error(result.error);
        
        const data = result.metadata;
        const totalDuration = Number(data?.total_duration);
        const evalDuration = Number(data?.eval_duration);
        const evalCount = Number(data?.eval_count);
        
        const evalTimeMs = evalDuration / 1e6;
        const tokensPerSecond = (evalCount && evalTimeMs > 0) ? evalCount / (evalTimeMs / 1000) : 0;

        let score = 0;
        if (testType === 'intelligence') {
            const hasJson = result.success?.includes('{') && result.success?.includes('}');
            score = hasJson ? 100 : 30;
        } else if (testType === 'context') {
            const correctWord = result.success?.toLowerCase().includes('claritas');
            score = correctWord ? 100 : 20;
        }

        return {
            success: true,
            metrics: {
                tokensPerSecond,
                totalTimeMs: totalDuration / 1e6,
                evalTimeMs,
                evalCount,
                model: config.model,
                testType,
                score,
                rawResponse: result.success
            }
        };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function checkOllamaConnection(config: OllamaConfig): Promise<{ success: boolean; error?: string; modelCount?: number }> {
    try {
        const url = config.baseUrl.replace(/\/+$/, '') + '/api/tags';
        const authHeader = config.apiKey?.startsWith('Bearer ') ? config.apiKey : `Bearer ${config.apiKey}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'ngrok-skip-browser-warning': 'true'
            }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return { success: true, modelCount: data.models?.length || 0 };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function getFinancialInsights(financialData: string, geminiKey?: string): Promise<{ success?: string[]; error?: any }> {
  try {
    if (geminiKey) {
        process.env.GEMINI_API_KEY = geminiKey;
    }
    const insights = await generateFinancialInsights(financialData);
    return { success: insights };
  } catch (e: any) {
    console.error("[Action Error] getFinancialInsights:", e);
    return { error: e.message || "Desculpe, não consegui processar isso." };
  }
}

export async function sendFinancialSummaryEmail(userId: string, userEmail: string, summary: { income: number, expenses: number, balance: number }) {
  try {
    const emailSubject = "Seu Resumo Financeiro Semanal - Claritas Copilot";
    const emailBody = `
      Olá,

      Aqui está um resumo da sua situação financeira:

      - Renda Mensal: R$${summary.income.toFixed(2)}
      - Despesas Mensais: R$${summary.expenses.toFixed(2)}
      - Saldo: R$${summary.balance.toFixed(2)}

      Atenciosamente,
      Equipe Claritas Copilot
    `;

    console.log("===================================");
    console.log("SIMULANDO ENVIO DE EMAIL");
    console.log(`Para: ${userEmail}`);
    console.log(`Assunto: ${emailSubject}`);
    console.log("===================================");

    return { success: `Email de teste enviado para o console.` };
  } catch (error) {
    console.error("Falha ao enviar email de resumo:", error);
    return { error: "Não foi possível enviar o email de resumo." };
  }
}

export async function checkGeminiConnection(key?: string): Promise<{ success: boolean; error?: string, models?: any[] }> {
    const apiKey = key || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return { success: false, error: "Chave de API não configurada." };
    }

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!response.ok) {
            const errorBody = await response.json();
            throw new Error(errorBody.error.message || `HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return { success: true, models: data.models };
    } catch (e: any) {
        console.error("[Health Check] Gemini API error:", e);
        return { success: false, error: e.message || "Ocorreu um erro desconhecido ao contatar a API do Gemini." };
    }
}

/**
 * Verifica a conexão com o Firestore (Stub no servidor para o componente de Status).
 */
export async function checkFirestoreConnection(): Promise<{ success: boolean; error?: string }> {
    return { success: true };
}

/**
 * Verifica a conexão com a Deriv usando o novo fluxo OTP.
 */
export async function checkDerivConnection(token: string, accountId: string): Promise<{ success: boolean; error?: string, assetCount?: number }> {
    if (!token || !accountId) {
        return { success: false, error: "Token ou AccountID não fornecidos." };
    }

    const urlResult = await getDerivWebSocketUrl(token, accountId);
    if (!urlResult.success) {
        return { success: false, error: urlResult.error };
    }

    return new Promise((resolve) => {
        const ws = new WebSocket(urlResult.url!);
        let timeoutId: NodeJS.Timeout;

        const cleanup = () => {
            clearTimeout(timeoutId);
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        };

        ws.on('open', () => {
            ws.send(JSON.stringify({ active_symbols: 'brief', "req_id": 2 }));
        });

        ws.on('message', (data) => {
            try {
                const response = JSON.parse(data.toString());
                if (response.error) {
                    resolve({ success: false, error: response.error.message });
                    cleanup();
                    return;
                }

                if (response.msg_type === 'active_symbols' && response.req_id === 2) {
                    resolve({ success: true, assetCount: response.active_symbols.length });
                    cleanup();
                }
            } catch (e) {
                resolve({ success: false, error: "Erro ao processar resposta da API." });
                cleanup();
            }
        });

        ws.on('error', (error) => {
            resolve({ success: false, error: `Erro de WebSocket: ${error.message}` });
            cleanup();
        });

        ws.on('close', () => {
             resolve({ success: false, error: "A conexão com a API da Deriv foi encerrada durante o teste." });
             cleanup();
        });

        timeoutId = setTimeout(() => {
            resolve({ success: false, error: "Tempo de conexão esgotado." });
            cleanup();
        }, 15000); 
    });
}
