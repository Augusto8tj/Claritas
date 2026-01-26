// src/app/master-autopilot/page.tsx
'use client';

import React from "react";
import { DerivApiProviderAccumulators } from "@/features/trading/hooks/use-deriv-api-accumulators";
import { MasterAutopilotInterface } from "@/features/trading/components/master-autopilot/master-autopilot-interface";

function MasterAutopilotPageContent() {
    return (
        <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
            <div className="flex items-center justify-between space-y-2">
                <h1 className="text-3xl font-bold tracking-tight font-headline">
                Central de Comando - Master Autopilot
                </h1>
            </div>
            <p className="text-muted-foreground">
                Um painel unificado para gerir todos os ecossistemas de trading com base no motor preditivo de alta assertividade.
            </p>
            <MasterAutopilotInterface />
        </div>
    );
}

export default function MasterAutopilotPage() {
  // Usando o provider dos Accumulators por enquanto, pois ele tem os dados de volatilidade necessários
  return (
    <DerivApiProviderAccumulators>
        <MasterAutopilotPageContent />
    </DerivApiProviderAccumulators>
  );
}
