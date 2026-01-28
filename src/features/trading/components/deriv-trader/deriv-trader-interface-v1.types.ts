// src/features/trading/components/deriv-trader/deriv-trader-interface-v1.types.ts
import { z } from 'zod';
import { baseRiseFallSchema } from '@/lib/types'; // Importando o schema base

export const riseFallSchema = baseRiseFallSchema.refine(
  (data) => {
    if (data.duration_unit === 's') {
      return data.duration >= 15;
    }
    return true;
  },
  {
    message: "A duração para segundos deve ser de no mínimo 15.",
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
export type DurationUnit = z.infer<typeof baseRiseFallSchema.shape.duration_unit>;
