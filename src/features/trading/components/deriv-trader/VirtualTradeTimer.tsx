// /src/features/trading/components/deriv-trader/VirtualTradeTimer.tsx
'use client';

import { useState, useEffect } from 'react';
import { Timer } from 'lucide-react';

const formatTime = (ms: number): string => {
    if (ms <= 0) return "00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

interface VirtualTradeTimerProps {
  exitEpoch: number;
}

export function VirtualTradeTimer({ exitEpoch }: VirtualTradeTimerProps) {
  const [remainingMs, setRemainingMs] = useState(exitEpoch * 1000 - Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setRemainingMs(exitEpoch * 1000 - Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [exitEpoch]);

  const timeText = formatTime(remainingMs);

  return (
    <p className="text-[10px] text-muted-foreground flex items-center justify-end gap-1 font-mono">
      <Timer className="h-3 w-3" />
      {timeText}
    </p>
  );
}
