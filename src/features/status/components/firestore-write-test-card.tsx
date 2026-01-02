// src/features/status/components/firestore-write-test-card.tsx
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { Loader2, AlertTriangle, CheckCircle, Database, Trash2, Edit } from 'lucide-react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';
type OperationType = 'write' | 'delete';

export function FirestoreWriteTestCard() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [status, setStatus] = useState<TestStatus>('idle');
    const [operation, setOperation] = useState<OperationType | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleTest = async (op: OperationType) => {
        if (!user) {
            toast({
                title: "Utilizador não autenticado",
                description: "Por favor, faça login para realizar o teste.",
                variant: "destructive",
            });
            return;
        }

        setStatus('testing');
        setOperation(op);
        setError(null);

        const testDocRef = doc(db, `users/${user.uid}/diagnostico/test-doc`);

        try {
            if (op === 'write') {
                await setDoc(testDocRef, {
                    message: 'teste de escrita',
                    timestamp: new Date().toISOString(),
                });
            } else {
                await deleteDoc(testDocRef);
            }
            setStatus('success');
        } catch (e: any) {
            console.error(`[Firestore Test] Failed on ${op} operation:`, e);
            setError(e.message || 'Ocorreu um erro desconhecido.');
            setStatus('error');
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    Diagnóstico de Leitura/Escrita no Firestore
                </CardTitle>
                <CardDescription>
                    Teste ativamente as permissões de escrita e eliminação na base de dados para garantir que as regras de segurança estão a funcionar corretamente.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Como Usar</AlertTitle>
                    <AlertDescription>
                        Clique em "Iniciar Teste de Escrita" para criar um documento de teste. Depois, clique em "Iniciar Teste de Eliminação" para o remover. Ambas as operações devem ser bem-sucedidas.
                    </AlertDescription>
                </Alert>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Button onClick={() => handleTest('write')} disabled={status === 'testing'}>
                        {status === 'testing' && operation === 'write' ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Edit className="mr-2 h-4 w-4" />
                        )}
                        Iniciar Teste de Escrita
                    </Button>
                    <Button
                        onClick={() => handleTest('delete')}
                        disabled={status === 'testing'}
                        variant="destructive"
                    >
                        {status === 'testing' && operation === 'delete' ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        Iniciar Teste de Eliminação
                    </Button>
                </div>

                {status === 'success' && (
                    <Alert variant="default" className="bg-green-500/10 border-green-500/50">
                        <CheckCircle className="h-4 w-4 text-green-700" />
                        <AlertTitle className="text-green-800 font-bold">Operação Bem-sucedida!</AlertTitle>
                        <AlertDescription className="text-xs text-green-700">
                            O teste de <strong>{operation === 'write' ? 'escrita' : 'eliminação'}</strong> foi concluído com sucesso. As permissões do Firestore estão corretas para esta operação.
                        </AlertDescription>
                    </Alert>
                )}

                {status === 'error' && (
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Falha na Operação de {operation === 'write' ? 'Escrita' : 'Eliminação'}</AlertTitle>
                        <AlertDescription className="whitespace-pre-wrap text-xs">
                            O Firestore bloqueou a operação. Verifique as regras de segurança para a coleção "diagnostico".
                            <br />
                            <br />
                            <strong>Detalhe do Erro:</strong> {error}
                        </AlertDescription>
                    </Alert>
                )}
            </CardContent>
        </Card>
    );
}
