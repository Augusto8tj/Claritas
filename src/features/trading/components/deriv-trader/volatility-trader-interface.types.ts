// src/features/trading/components/deriv-trader/volatility-trader-interface.types.ts
import { z } from 'zod';

export const volatilityTraderSchema = z.object({
  stake: z.coerce.number().min(0.35, "O valor mínimo é $0.35."),
  duration: z.coerce.number().min(15, "A duração mínima é 15 segundos."),
});

export type VolatilityTraderFormValues = z.infer<typeof volatilityTraderSchema>;
