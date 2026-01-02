// /src/app/actions/transaction-actions.ts
"use server";

import { z } from "zod";
import { addTransaction as addTransactionToService } from "@/services/financial-data-service";
import { revalidatePath } from "next/cache";

const transactionSchema = z.object({
  userId: z.string(),
  description: z.string().min(1, "A descrição é obrigatória."),
  amount: z.coerce.number().positive("O valor deve ser positivo."),
  type: z.enum(["income", "expense"], {
    required_error: "O tipo é obrigatório.",
  }),
  category: z.string().min(1, "A categoria é obrigatória."),
  date: z.string().min(1, "A data é obrigatória."),
});

export async function addTransaction(data: {
  userId: string;
  description: string;
  amount: number;
  type: "income" | "expense";
  category: string;
  date: string;
}) {
  const validatedData = transactionSchema.safeParse(data);

  if (!validatedData.success) {
    return { error: validatedData.error.flatten().fieldErrors };
  }

  try {
    // A função de serviço agora adiciona o userId internamente ao objeto
    // e usa uma escrita não-bloqueante.
    await addTransactionToService(validatedData.data.userId, validatedData.data);
    
    // Revalida os caminhos para atualizar a UI
    revalidatePath("/analysis");
    revalidatePath("/budget");
    revalidatePath("/"); // Revalidate dashboard to update monthly balance
    
    return { success: true };
  } catch (e) {
    console.error("Erro na Server Action 'addTransaction':", e);
    // A falha de permissão agora é tratada no serviço, mas podemos ter outros erros.
    return { error: "Ocorreu um erro inesperado ao adicionar a transação." };
  }
}
