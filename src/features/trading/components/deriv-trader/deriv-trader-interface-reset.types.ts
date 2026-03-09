// src/features/trading/components/deriv-trader/deriv-trader-interface-reset.types.ts
import { z } from 'zod';

export const resetSchema = z.object({
  stake: z.coerce.number().min(0.35, "O valor mínimo é $0.35."),
  reset_barrier_offset: z.string().refine(val => /^[+-]\d+(\.\d+)?$/.test(val), {
    message: "O offset deve começar com '+' ou '-' e ser um número válido (ex: '+0.05')."
  })
});

export type ResetFormValues = z.infer<typeof resetSchema>;
