// /src/app/actions.ts
"use server";

import {
  financialChatbotInsights,
} from "@/ai/flows/financial-chatbot-insights";
import type { FinancialChatbotInsightsInput } from "@/lib/types";
import { getFinancialSummary, getInsights } from "@/services/financial-data-service";
import { auth, db } from "@/lib/firebase";
import WebSocket from 'ws';
import { getDoc, doc } from 'firebase/firestore';


export async function getChatbotInsightsResponse(data: FinancialChatbotInsightsInput) {
  try {
    const result = await financialChatbotInsights(data);
    return { success: result.response };
  } catch (e) {
    console.error(e);
    return { error: "Desculpe, não consegui processar isso. Por favor, tente novamente." };
  }
}

export async function sendFinancialSummaryEmail(userId: string, userEmail: string) {
  try {
    const summary = await getFinancialSummary(userId);
    const insights = await getInsights();

    const emailSubject = "Seu Resumo Financeiro Semanal - Claritas Copilot";
    const emailBody = `
      Olá,

      Aqui está um resumo da sua situação financeira:

      - Renda Mensal: R$${summary.income.toFixed(2)}
      - Despesas Mensais: R$${summary.expenses.toFixed(2)}
      - Saldo: R$${summary.balance.toFixed(2)}

      Insights da IA para você:
      ${insights.map(i => `- ${i}`).join("\n")}

      Continue acompanhando suas finanças!

      Atenciosamente,
      Equipe Claritas Copilot
    `;

    console.log("===================================");
    console.log("SIMULANDO ENVIO DE EMAIL");
    console.log(`Para: ${userEmail}`);
    console.log(`Assunto: ${emailSubject}`);
    console.log("Corpo:", emailBody);
    console.log("===================================");

    return { success: `Email de teste enviado para o console.` };
  } catch (error) {
    console.error("Falha ao enviar email de resumo:", error);
    return { error: "Não foi possível enviar o email de resumo." };
  }
}

export async function checkGeminiConnection(): Promise<{ success: boolean; error?: string, models?: any[] }> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return { success: false, error: "A variável de ambiente GEMINI_API_KEY não está definida." };
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

export async function checkDerivConnection(token: string): Promise<{ success: boolean; error?: string, assetCount?: number }> {
    if (!token) {
        return { success: false, error: "O token da API não foi fornecido." };
    }
    const DERIV_APP_ID = process.env.NEXT_PUBLIC_DERIV_APP_ID || "1089";

    return new Promise((resolve) => {
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);
        let timeoutId: NodeJS.Timeout;

        const cleanup = () => {
            clearTimeout(timeoutId);
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        };

        ws.onopen = () => {
            ws.send(JSON.stringify({ "authorize": token, "req_id": 1 }));
        };

        ws.onmessage = (event) => {
            try {
                const response = JSON.parse(event.data.toString());
                if (response.error) {
                    resolve({ success: false, error: response.error.message });
                    cleanup();
                    return;
                }

                if (response.msg_type === 'authorize' && response.req_id === 1) {
                    if (response.authorize) {
                        // Successfully authorized, now request active symbols
                        ws.send(JSON.stringify({ active_symbols: 'brief', product_type: 'basic', "req_id": 2 }));
                    } else {
                        resolve({ success: false, error: "Autorização falhou. Token inválido." });
                        cleanup();
                    }
                } else if (response.msg_type === 'active_symbols' && response.req_id === 2) {
                    resolve({ success: true, assetCount: response.active_symbols.length });
                    cleanup();
                }
            } catch (e) {
                resolve({ success: false, error: "Erro ao processar resposta da API." });
                cleanup();
            }
        };

        ws.onerror = (error) => {
            resolve({ success: false, error: `Erro de WebSocket: ${error.message}` });
            cleanup();
        };

        ws.onclose = (event) => {
            if (!event.wasClean) {
                 resolve({ success: false, error: "A conexão com a API da Deriv foi encerrada inesperadamente." });
                 cleanup();
            }
        };

        timeoutId = setTimeout(() => {
            resolve({ success: false, error: "Tempo de conexão esgotado." });
            cleanup();
        }, 10000); // 10-second timeout
    });
}

export async function checkFirestoreConnection(): Promise<{ success: boolean; error?: string; }> {
    try {
        // Tentamos aceder a um documento que não existe num caminho protegido por regras de autenticação.
        // O objetivo não é ler os dados, mas sim confirmar que o pedido é processado pelo Firestore.
        // Um erro de "permission-denied" é, para este teste, um SUCESSO, pois confirma que
        // a conexão está ativa e as regras de segurança estão a ser aplicadas.
        const unauthenticatedRef = doc(db, 'users', 'test-connection');
        await getDoc(unauthenticatedRef);
        
        // Se chegarmos aqui sem um erro de permissão, algo está errado com as regras.
        return { success: false, error: "As regras de segurança podem não estar a proteger os dados corretamente. Acesso não autenticado foi permitido." };
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            // Este é o resultado esperado e significa que a conexão e as regras estão a funcionar.
            return { success: true };
        }
        // Qualquer outro erro é uma falha na conexão.
        console.error("[Health Check] Firestore error:", e);
        return { success: false, error: e.message || "Ocorreu um erro desconhecido ao contatar o Firestore." };
    }
}
