// /src/features/trading/components/deriv-trader/pending-operation-counter.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import { Loader2, XSquare } from 'lucide-react';
import type { Operation } from "@/lib/types";
import { Button } from '@/components/ui/button';
import { cn } from "@/lib/utils";
import { getGradientStyle } from './utils/get-gradient-style';

interface PendingOperationCounterProps {
  operation: Operation;
  onSell: () => void;
  isSelling: boolean;
  currentStatus: 'winning' | 'losing' | 'even';
}

const formatTime = (ms: number): string => {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export function PendingOperationCounter({ operation, onSell, isSelling, currentStatus }: PendingOperationCounterProps) {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const { isSellable, expirationTime } = operation;

  const buttonStyle = useMemo(() => {
    return getGradientStyle({
      isWinning: currentStatus === 'winning',
      isEven: currentStatus === 'even',
    });
  }, [currentStatus]);

  useEffect(() => {
    if (!expirationTime) return;

    const interval = setInterval(() => {
        const newRemainingMs = expirationTime - Date.now();
        setRemainingMs(newRemainingMs);
        if (newRemainingMs <= 0) {
            clearInterval(interval);
        }
    }, 1000);

    // Set initial value immediately
    setRemainingMs(expirationTime - Date.now());

    return () => clearInterval(interval);
  }, [expirationTime]);

  // Contrato vendável se for temporal e tiver mais de 1 segundo de vida
  const isSellableNow = isSellable && remainingMs !== null && remainingMs > 15000;
  
  const renderCounter = () => {
    if (remainingMs === null) {
      return (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="text-xs">Calculando...</span>
        </div>
      );
    }

    if (remainingMs <= 0) {
        return (
             <div className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="text-xs">Aguardando...</span>
            </div>
        )
    }

    return (
       <div className="flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
            <span className="font-mono text-xs font-medium">{formatTime(remainingMs)}</span>
       </div>
    );
  };
  
  return (
    <div className="flex items-center gap-2">
      {renderCounter()}
      {isSellable && (
        <Button 
            style={buttonStyle}
            variant="outline"
            size="sm" 
            className={cn(
                "h-7 px-2.5 transition-all text-white border-none",
                !buttonStyle && 'bg-muted hover:bg-muted/90 text-muted-foreground',
                (!isSellableNow || isSelling) && 'opacity-50 cursor-not-allowed grayscale'
            )}
            onClick={onSell}
            disabled={!isSellableNow || isSelling}
        >
          {isSelling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <XSquare className="h-3.5 w-3.5 mr-1.5" />
              <span className="text-xs font-semibold">Encerrar</span>
            </>
          )}
        </Button>
      )}
    </div>
  );
}
