// src/features/trading/components/deriv-trader/deriv-trader-interface-reset.types.ts
import { z } from 'zod';

export const resetSchema = z.object({
  stake: z.coerce.number().min(0.35, "O valor mínimo é $0.35."),
  duration: z.coerce.number().min(1, "A duração deve ser de pelo menos 1."),
  duration_unit: z.enum(['m', 'h', 'd', 's', 't']),
  barrierOffset: z.string().optional(),
}).refine((data) => {
    // A validação só se aplica se uma barreira for fornecida.
    if (data.barrierOffset && data.barrierOffset.length > 0) {
        return /^[+-]\d+(\.\d+)?$/.test(data.barrierOffset);
    }
    return true;
}, {
    message: "O offset deve começar com '+' ou '-' e ser um número válido (ex: '+0.05').",
    path: ["barrierOffset"],
});


export type ResetFormValues = z.infer<typeof resetSchema>;
export type DurationUnit = z.infer<typeof resetSchema.shape.duration_unit>;
