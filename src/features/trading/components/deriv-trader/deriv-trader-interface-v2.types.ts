// src/features/trading/components/deriv-trader/deriv-trader-interface-v2.types.ts
import { z } from 'zod';

export const riseFallSchema = z.object({
  stake: z.coerce.number().min(0.35, "O valor mínimo é $0.35."),
  duration: z.coerce.number().min(1, "A duração deve ser de pelo menos 1."),
  duration_unit: z.enum(['t', 's', 'm', 'h', 'd']),
  allowEquals: z.boolean().default(false),
}).refine(
  (data) => {
    if (data.duration_unit === 's') {
      return data.duration >= 11;
    }
    return true;
  },
  {
    message: "A duração para segundos deve ser de no mínimo 11.",
    path: ["duration"],
  }
).refine(
  (data) => {
    if (data.duration_unit === 't') {
      return data.duration <= 10;
    }
    return true;
  },
  {
    message: "A duração para ticks deve ser de no máximo 10.",
    path: ["duration"],
  }
);


export type RiseFallFormValues = z.infer<typeof riseFallSchema>;
