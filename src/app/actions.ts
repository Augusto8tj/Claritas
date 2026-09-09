
// /src/app/actions.ts
"use server";

import {
  financialChatbotInsights,
} from "@/ai/flows/financial-chatbot-insights";
import type { FinancialChatbotInsightsInput, OllamaConfig } from "@/lib/types";
import { getFinancialSummary } from "@/services/financial-data-service";
import { auth, db } from "@/lib/firebase";
import WebSocket from 'ws';
import { getDoc, doc } from 'firebase/firestore';
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
    // Injeta a chave do cliente no ambiente do processo para esta execução de fluxo
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
 * Interface para chamadas ao Ollama Studio Local
 */
export async function getOllamaResponse(config: OllamaConfig, query: string, history: any[]): Promise<{ success?: string; error?: string }> {
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
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama Error: ${errorText}`);
    }

    const data = await response.json();
    return { success: data.message?.content || "(Sem resposta do Ollama)" };
  } catch (e: any) {
    console.error("[Action Error] getOllamaResponse:", e);
    return { error: e.message || "Erro ao conectar com Ollama Local." };
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

export async function sendFinancialSummaryEmail(userId: string, userEmail: string) {
  try {
    const summary = await getFinancialSummary(userId);
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

export async function checkFirestoreConnection(): Promise<{ success: boolean; error?: string; }> {
    try {
        const unauthenticatedRef = doc(db, 'users', 'test-connection');
        await getDoc(unauthenticatedRef);
        return { success: false, error: "As regras de segurança podem não estar a proteger os dados corretamente." };
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            return { success: true };
        }
        console.error("[Health Check] Firestore error:", e);
        return { success: false, error: e.message || "Ocorreu um erro desconhecido ao contatar o Firestore." };
    }
}
