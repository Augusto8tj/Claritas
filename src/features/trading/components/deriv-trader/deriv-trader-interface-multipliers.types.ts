// src/features/trading/components/deriv-trader/deriv-trader-interface-multipliers.types.ts
import { z } from 'zod';

export const multipliersSchema = z.object({
  stake: z.coerce.number().min(1.0, "O valor mínimo para Multiplicadores é $1.00."),
  multiplier: z.coerce.number().min(1, "O multiplicador deve ser de pelo menos 1."),
  takeProfit: z.coerce.number().min(0.01, "O Take Profit deve ser maior que $0.01.").optional(),
  stopLoss: z.coerce.number().min(0.01, "O Stop Loss deve ser maior que $0.01.").optional(),
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
