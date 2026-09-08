// src/features/trading/components/deriv-trader/deriv-trader-interface-reset.types.ts
import { z } from 'zod';

const baseResetSchema = z.object({
  stake: z.coerce.number().min(0.35, "O valor mínimo é $0.35."),
  duration: z.coerce.number().min(1, "A duração deve ser de pelo menos 1."),
  duration_unit: z.enum(['m', 'h', 'd', 's', 't']),
  barrierOffset: z.string().optional(),
});

export const resetSchema = baseResetSchema.refine((data) => {
    // A validação só se aplica se uma barreira for fornecida.
    if (data.barrierOffset && data.barrierOffset.length > 0) {
        // Permite '+' ou '-' seguido por números, opcionalmente com um ponto e 1 ou 2 casas decimais.
        return /^[+-]\d+(\.\d{1,2})?$/.test(data.barrierOffset);
    }
    return true;
}, {
    message: "O offset deve começar com '+' ou '-' e ter no máximo 2 casas decimais (ex: '+0.50').",
    path: ["barrierOffset"],
});


export type ResetFormValues = z.infer<typeof resetSchema>;
export type DurationUnit = z.infer<typeof baseResetSchema.shape.duration_unit>;
