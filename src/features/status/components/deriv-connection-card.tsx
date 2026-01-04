// /src/features/status/components/deriv-connection-card.tsx
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useDerivApi } from '@/features/trading/hooks/use-deriv-api';
import { Loader2, AlertTriangle, CheckCircle, Link } from 'lucide-react';

export function DerivConnectionCard() {
    const [isChecking, setIsChecking] = useState(false);
    const { isConnected, isConnecting, connectionError, reconnect, accountType } = useDerivApi();

    const handleCheckConnection = async () => {
        setIsChecking(true);
        await reconnect();
        setIsChecking(false);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Link className="h-5 w-5" />Diagnóstico de Conexão da Corretora</CardTitle>
                <CardDescription>Use para forçar uma reconexão ou diagnosticar problemas com o token da API da Deriv.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <Alert variant="default">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Como Usar</AlertTitle>
                    <AlertDescription>
                        Se o card "API Deriv" acima mostrar uma falha, clique no botão abaixo. Isso tentará usar o seu token ativo ({accountType}) para se reconectar e validar.
                    </AlertDescription>
                </Alert>
                <Button onClick={handleCheckConnection} disabled={isConnecting || isChecking}>
                    {(isConnecting || isChecking) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {(isConnecting || isChecking) ? "A verificar..." : "Forçar Reconexão e Validar"}
                </Button>

                {connectionError && !isConnecting && (
                    <div className="space-y-1.5">
                        <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Falha na Conexão</AlertTitle>
                            <AlertDescription className="whitespace-pre-wrap text-xs">
                                {connectionError}
                            </AlertDescription>
                        </Alert>
                    </div>
                )}
                 {isConnected && !isConnecting && !connectionError && (
                    <div className="space-y-1.5">
                        <Alert variant="default" className="bg-green-500/10 border-green-500/50">
                            <CheckCircle className="h-4 w-4 text-green-700" />
                            <AlertTitle className="text-green-800">Conexão Ativa</AlertTitle>
                            <AlertDescription className="whitespace-pre-wrap text-xs text-green-700">
                                A conexão com a API da Deriv está a funcionar corretamente.
                            </AlertDescription>
                        </Alert>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
