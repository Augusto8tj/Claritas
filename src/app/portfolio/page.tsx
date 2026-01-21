// /src/app/portfolio/page.tsx
'use client';

import { OpenPositions } from "@/features/trading/components/deriv-trader/OpenPositions";
import { useMemo, useState, useEffect } from "react";
import type { Operation } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, Info } from "lucide-react";

// Chaves de localStorage para os logs de operações
const DERIV_V1_LOG_KEY = 'derivV1OperationsLog_v1';
const DERIV_V2_LOG_KEY = 'derivV2OperationsLog_v2.5';
const DERIV_MULTIPLIERS_LOG_KEY = 'derivMultipliersOperationsLog_v3';

function PortfolioContent() {
    // Estado local para armazenar os logs lidos do localStorage
    const [opsV1, setOpsV1] = useState<Operation[]>([]);
    const [opsV2, setOpsV2] = useState<Operation[]>([]);
    const [opsMultipliers, setOpsMultipliers] = useState<Operation[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // useEffect para carregar os dados do localStorage na montagem do componente
    useEffect(() => {
        setIsLoading(true);
        try {
            const storedV1 = localStorage.getItem(DERIV_V1_LOG_KEY);
            const storedV2 = localStorage.getItem(DERIV_V2_LOG_KEY);
            const storedMultipliers = localStorage.getItem(DERIV_MULTIPLIERS_LOG_KEY);

            if (storedV1) setOpsV1(JSON.parse(storedV1));
            if (storedV2) setOpsV2(JSON.parse(storedV2));
            if (storedMultipliers) setOpsMultipliers(JSON.parse(storedMultipliers));
        } catch (error) {
            console.error("Portfolio Page: Failed to load logs from localStorage", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // A lógica de memoização para combinar e filtrar as operações permanece
    const allUniqueOperations = useMemo(() => {
        const combined = [
            ...opsV1.map(op => ({...op, source: 'V1'})),
            ...opsV2.map(op => ({...op, source: 'V2.5'})),
            ...opsMultipliers.map(op => ({...op, source: 'Multiplicadores'}))
        ];

        const uniqueOpsMap = new Map<number, typeof combined[0]>();
        combined.forEach(op => {
            if (op && op.id) {
                 uniqueOpsMap.set(op.id, op);
            }
        });
        
        return Array.from(uniqueOpsMap.values());
    }, [opsV1, opsV2, opsMultipliers]);

    const allOpenPositions = useMemo(() => {
        return allUniqueOperations
            .filter(op => op && op.status === 'pending')
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }, [allUniqueOperations]);

    return (
        <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
            <div className="flex items-center justify-between space-y-2">
                <h1 className="text-3xl font-bold tracking-tight font-headline">
                Portfólio de Posições
                </h1>
            </div>
            <p className="text-muted-foreground">
                Visão unificada de todas as posições abertas em todas as plataformas de trading.
            </p>
             <Card className="bg-primary/5 border-primary/10">
                <CardHeader className="flex flex-row items-center gap-4">
                    <Info className="h-5 w-5 text-primary" />
                    <div>
                        <CardTitle className="text-base text-primary">Vista de Dados Estática</CardTitle>
                        <CardDescription className="text-primary/80 text-xs">
                            Esta página lê os dados do seu navegador para evitar conflitos de conexão. Para dados em tempo real, visite a página de trading específica.
                        </CardDescription>
                    </div>
                </CardHeader>
            </Card>
            <OpenPositions 
                title="Todas as Posições Abertas"
                description="Visão consolidada de contratos de Opções e Multiplicadores."
                operations={allOpenPositions}
            />
        </div>
    );
}

export default function PortfolioPage() {
    // O FormProvider e os provedores de API foram removidos para desacoplar a página.
    return <PortfolioContent />;
}
