// src/features/trading/components/deriv-trader/deriv-trader-interface-multipliers.types.ts
import { z } from 'zod';

export const multipliersSchema = z.object({
  stake: z.coerce.number().min(0.35, "O valor mínimo é $0.35."),
  multiplier: z.coerce.number().min(1, "O multiplicador deve ser de pelo menos 1."),
  takeProfit: z.coerce.number().positive("O Take Profit deve ser um valor positivo.").optional(),
  stopLoss: z.coerce.number().positive("O Stop Loss deve ser um valor positivo.").optional(),
}).refine((data) => {
    if (data.stopLoss !== undefined) {
        return data.stopLoss < data.stake;
    }
    return true;
}, {
    message: "Stop Loss deve ser menor que o valor da aposta.",
    path: ["stopLoss"],
});

export type MultipliersFormValues = z.infer<typeof multipliersSchema>;
