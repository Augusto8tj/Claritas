// src/features/trading/components/deriv-trader/deriv-trader-interface-digits.types.ts
import { z } from 'zod';

export const digitSchema = z.object({
  stake: z.coerce.number().min(0.35, "O valor mínimo é $0.35."),
  duration: z.coerce.number().min(1, "A duração para dígitos é de 1 a 10 ticks.").max(10, "A duração máxima é de 10 ticks."),
  duration_unit: z.literal('t', {
    errorMap: () => ({ message: "Apenas 'ticks' são suportados para contratos de dígitos." })
  }),
  // Torna-se opcional, pois não é necessário para Par/Ímpar
  last_digit_prediction: z.coerce.number().min(0).max(9).optional(),
});

export type DigitFormValues = z.infer<typeof digitSchema>;
export type DurationUnit = z.infer<typeof digitSchema.shape.duration_unit>;
