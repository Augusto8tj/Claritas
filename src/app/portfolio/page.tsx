// /src/app/portfolio/page.tsx
'use client';

import { DerivApiProviderV1, useDerivApiV1 } from "@/features/trading/hooks/use-deriv-api-v1";
import { DerivApiProviderV2, useDerivApiV2 } from "@/features/trading/hooks/use-deriv-api-v2";
import { DerivApiProviderMultipliers, useDerivApiMultipliers } from "@/features/trading/hooks/use-deriv-api-multipliers";
import { OpenPositions } from "@/features/trading/components/deriv-trader/OpenPositions";
import { useMemo } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { riseFallSchema, type RiseFallFormValues } from "@/features/trading/components/deriv-trader/deriv-trader-interface-v1.types";

function PortfolioContent() {
    const { operationsLog: opsV1 } = useDerivApiV1();
    const { operationsLog: opsV2 } = useDerivApiV2();
    const { operationsLog: opsMultipliers } = useDerivApiMultipliers();

    // Combine all operations from different sources and de-duplicate by contract ID.
    const allUniqueOperations = useMemo(() => {
        const combined = [
            ...opsV1.map(op => ({...op, source: 'V1'})),
            ...opsV2.map(op => ({...op, source: 'V2.5'})),
            ...opsMultipliers.map(op => ({...op, source: 'Multiplicadores'}))
        ];

        // Use a Map to ensure uniqueness based on the contract `id`.
        const uniqueOpsMap = new Map<number, typeof combined[0]>();
        combined.forEach(op => {
            if (op && op.id) { // Ensure op and op.id are valid
                 uniqueOpsMap.set(op.id, op);
            }
        });
        
        return Array.from(uniqueOpsMap.values());
    }, [opsV1, opsV2, opsMultipliers]);

    // Filter for open positions and sort them.
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
            <OpenPositions 
                title="Todas as Posições Abertas"
                description="Visão consolidada de contratos de Opções e Multiplicadores."
                operations={allOpenPositions}
            />
        </div>
    );
}

export default function PortfolioPage() {
    // A FormProvider is needed here because some components inside the DerivApiProviders
    // might depend on the form context. This is a safe way to ensure compatibility.
    const form = useForm<RiseFallFormValues>({
        resolver: zodResolver(riseFallSchema),
        defaultValues: {
            stake: 1,
            duration: 15,
            duration_unit: "s",
        },
    });

    return (
        <DerivApiProviderV1>
            <DerivApiProviderV2>
                <DerivApiProviderMultipliers>
                    <FormProvider {...form}>
                        <PortfolioContent />
                    </FormProvider>
                </DerivApiProviderMultipliers>
            </DerivApiProviderV2>
        </DerivApiProviderV1>
    );
}
