'use client';

import React from 'react';
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldAlert, Gauge, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface RadarResilienceBadgesProps {
  rigor: number;
  isStable: boolean;
}

/**
 * RadarResilienceBadges - Visualização Tática V4.0
 * Exibe o status de resiliência adaptativa dentro dos cards do radar.
 */
export const RadarResilienceBadges = ({ rigor, isStable }: RadarResilienceBadgesProps) => {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-current/10">
      <Badge 
        variant="outline" 
        className="text-[9px] h-4 px-1.5 bg-blue-500/5 border-blue-500/20 text-blue-600 flex gap-1 items-center font-bold"
        title="Rigor Adaptativo: Ajustado conforme performance recente"
      >
        <Gauge className="h-2.5 w-2.5" />
        RIGOR: {(rigor * 100).toFixed(0)}%
      </Badge>
      
      <Badge 
        variant="outline" 
        className={cn(
          "text-[9px] h-4 px-1.5 flex gap-1 items-center border-none font-bold",
          isStable 
            ? "bg-green-500/10 text-green-600" 
            : "bg-red-500/20 text-red-600 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.3)]"
        )}
        title={isStable ? "Liquidez Estável" : "ALERTA: Estresse de Liquidez (Slippage High)"}
      >
        {isStable ? <ShieldCheck className="h-2.5 w-2.5" /> : <Activity className="h-2.5 w-2.5" />}
        {isStable ? "LIQUIDEZ OK" : "INSTÁVEL"}
      </Badge>
    </div>
  );
};
