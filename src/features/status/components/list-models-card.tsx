// /src/features/status/components/list-models-card.tsx
"use client";

import { AlertTriangle, BrainCircuit, CheckCircle, Loader2 } from 'lucide-react';
import React, { useState } from 'react';

import { checkGeminiConnection } from '@/app/actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

export function ListModelsCard() {
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<{ success: boolean; data?: string; error?: string; } | null>(null);

    const handleListModels = async () => {
        setIsLoading(true);
        setResult(null);
        try {
            const response = await checkGeminiConnection();
            if (response.success && response.models) {
                const modelList = response.models
                    .filter((model: any) => model.supportedGenerationMethods.includes('generateContent'))
                    .map((model: any) => `- ${model.displayName || model.name} (${model.name})`)
                    .join('\n') || 'Nenhum modelo compatível com "generateContent" foi encontrado.';
                setResult({ success: true, data: `Conexão bem-sucedida!\n\nModelos de geração de conteúdo disponíveis:\n\n${modelList}` });
            } else {
                throw new Error(response.error || "A verificação da IA retornou uma falha desconhecida.");
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Ocorreu um erro desconhecido.";
            setResult({ success: false, error: errorMessage });
        } finally {
            setIsLoading(false);
        }
    };
    
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><BrainCircuit className="h-5 w-5" />Diagnóstico de Modelos de IA</CardTitle>
                <CardDescription>Verifique quais modelos de IA estão realmente disponíveis para a sua chave de API.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <Alert variant="default">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Como Usar</AlertTitle>
                    <AlertDescription>
                        Se a IA apresentar erros de &quot;API key not valid&quot; ou de modelo não encontrado, clique no botão abaixo. Isso testa a conexão e valida a chave de API configurada no sistema, listando os modelos que ela pode acessar.
                    </AlertDescription>
                </Alert>
                <Button onClick={handleListModels} disabled={isLoading}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                    {isLoading ? "Verificando..." : "Verificar Conexão da IA"}
                </Button>

                {result && (
                     <Alert variant={result.success ? "default" : "destructive"} className={result.success ? "bg-green-500/10 border-green-500/50" : ""}>
                        {result.success ? <CheckCircle className="h-4 w-4 text-green-700"/> : <AlertTriangle className="h-4 w-4"/>}
                        <AlertTitle className={result.success ? "text-green-800 font-bold" : "font-bold"}>
                            {result.success ? "Diagnóstico Concluído" : "Falha no Diagnóstico"}
                        </AlertTitle>
                        <AlertDescription className="whitespace-pre-wrap text-xs">
                            {result.success ? result.data : result.error}
                        </AlertDescription>
                    </Alert>
                )}
            </CardContent>
        </Card>
    );
}
