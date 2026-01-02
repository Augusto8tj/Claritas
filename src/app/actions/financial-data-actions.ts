// /src/app/actions/financial-data-actions.ts
"use server";

import { z } from "zod";
import { addGoal as addGoalToService, deleteGoal as deleteGoalFromService } from "@/services/financial-data-service";
import type { Goal } from "@/lib/types";
import { revalidatePath } from "next/cache";

const addGoalSchema = z.object({
  userId: z.string(),
  name: z.string().min(1, "O nome da meta é obrigatório."),
  targetAmount: z.coerce.number().positive("O valor da meta deve ser positivo."),
});

export async function addGoal(data: { userId: string, name: string; targetAmount: number }): Promise<{ success?: Goal, error?: any }> {
  const validatedData = addGoalSchema.safeParse(data);
  if (!validatedData.success) {
    return { error: validatedData.error.flatten().fieldErrors };
  }

  try {
    // A função de serviço agora é não-bloqueante e lida com erros internamente
    const newGoal = await addGoalToService(validatedData.data.userId, validatedData.data.name, validatedData.data.targetAmount);
    revalidatePath("/goals");
    revalidatePath("/"); // Also revalidate dashboard for the carousel
    return { success: newGoal };
  } catch (e: any) {
    console.error("Erro na Server Action addGoal:", e);
    // Apenas repassa a mensagem de erro para ser tratada no cliente
    return { error: e.message || "Não foi possível criar a meta." };
  }
}

export async function deleteGoal(userId: string, goalId: string): Promise<{ success: boolean; error?: string }> {
    if(!goalId) {
        return { success: false, error: "ID da meta é obrigatório." };
    }
    try {
        const result = await deleteGoalFromService(userId, goalId);
        if(result.success) {
            revalidatePath("/goals");
            revalidatePath("/");
            return { success: true };
        }
        return { success: false, error: "Meta não encontrada." };
    } catch (e: any) {
        console.error(e);
        const errorMessage = e.message || "Ocorreu um erro inesperado ao deletar a meta.";
        return { success: false, error: errorMessage };
    }
}
