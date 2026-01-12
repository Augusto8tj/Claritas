// src/features/trading/components/deriv-trader/deriv-trader-interface-v1.types.ts
import { z } from 'zod';

export const riseFallSchema = z.object({
  stake: z.coerce.number().min(0.35, "O valor mínimo é $0.35."),
  duration: z.coerce.number().min(1, "A duração deve ser de pelo menos 1."),
  duration_unit: z.enum(['t', 's', 'm', 'h', 'd']),
  allowEquals: z.boolean().default(false),
});

export type RiseFallFormValues = z.infer<typeof riseFallSchema>;
