// src/components/status/deriv-connection-card.tsx
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { checkDerivConnection } from '@/app/actions';
import { useDerivApi } from '@/hooks/use-deriv-api';
import { Loader2, AlertTriangle, CheckCircle, Link } from 'lucide-react';

export function DerivConnectionCard() {
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<{ success: boolean; error?: string; assetCount?: number } | null>(null);
    const { activeToken, accountType } = useDerivApi();

    const handleCheckConnection = async () => {
        setIsLoading(true);
        setResult(null);

        if (!activeToken) {
            setResult({ success: false, error: "Nenhum token de API ativo (demo ou real) está configurado no seu navegador. Por favor, adicione um na página de configurações." });
            setIsLoading(false);
            return;
        }

        const response = await checkDerivConnection(activeToken);
        setResult(response);
        setIsLoading(false);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Link className="h-5 w-5" />Diagnóstico de Conexão da Corretora</CardTitle>
                <CardDescription>Verifique se o seu token de API da Deriv é válido e se a conexão pode ser estabelecida.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <Alert variant="default">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Como Usar</AlertTitle>
                    <AlertDescription>
                        Se o card "API Deriv" acima mostrar uma falha na conexão, clique no botão abaixo. Isso tentará usar o seu token ativo ({accountType}) para se conectar e validar.
                    </AlertDescription>
                </Alert>
                <Button onClick={handleCheckConnection} disabled={isLoading}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {isLoading ? "Verificando..." : "Verificar Conexão da Deriv"}
                </Button>

                {result && (
                    <div className="space-y-1.5">
                        <Alert variant={result.success ? "default" : "destructive"} className={result.success ? "bg-green-500/10 border-green-500/50" : ""}>
                            {result.success ? <CheckCircle className="h-4 w-4 text-green-700" /> : <AlertTriangle className="h-4 w-4" />}
                            <AlertTitle className={result.success ? "text-green-800" : ""}>{result.success ? "Diagnóstico Concluído" : "Falha no Diagnóstico"}</AlertTitle>
                            <AlertDescription className="whitespace-pre-wrap text-xs">
                                {result.success
                                    ? `Conexão bem-sucedida! O token é válido e ${result.assetCount} ativos foram encontrados.`
                                    : result.error
                                }
                            </AlertDescription>
                        </Alert>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
