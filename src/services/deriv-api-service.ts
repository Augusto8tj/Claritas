// /src/services/deriv-api-service.ts
'use client';

/**
 * @fileOverview This file contains only the type definitions for the Deriv API service.
 * All logic for creating WebSocket connections and making API calls has been centralized
 * in the use-deriv-api.tsx hook to prevent conflicting connections.
 */

export type AccountType = 'demo' | 'real';

export interface TradeResult {
  success: boolean;
  message: string;
  contractId?: number;
  entryTick?: number;
  entryTime?: number;
}
