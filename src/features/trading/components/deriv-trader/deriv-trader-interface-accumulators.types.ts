// src/features/trading/components/deriv-trader/deriv-trader-interface-accumulators.types.ts
import { z } from 'zod';

export const accumulatorSchema = z.object({
  stake: z.coerce.number().min(1.0, "O valor mínimo para Acumuladores é $1.00."),
  growth_rate: z.coerce.number().min(0.01, "A taxa deve ser de pelo menos 0.01 (1%).").max(0.05, "A taxa não pode ser maior que 0.05 (5%)."),
});

export type AccumulatorFormValues = z.infer<typeof accumulatorSchema>;
