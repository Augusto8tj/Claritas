// src/app/actions/goal-actions.ts
'use server';

import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, addDoc, doc, deleteDoc } from 'firebase/firestore';
import { revalidatePath } from 'next/cache';
import type { Goal } from '@/lib/types';
import { generateGoalImage } from '@/ai/flows/goal-image-generation';
import { getChatbotInsightsResponse } from '@/app/actions';

const addGoalSchema = z.object({
  userId: z.string(),
  name: z.string().min(1, 'O nome da meta é obrigatório.'),
  targetAmount: z.coerce.number().positive('O valor da meta deve ser positivo.'),
});

export async function createGoalWithAIImage(data: { userId: string, name: string; targetAmount: number }): Promise<{ success?: Goal, error?: any }> {
  const validatedData = addGoalSchema.safeParse(data);
  if (!validatedData.success) {
    return { error: validatedData.error.flatten().fieldErrors };
  }

  try {
    const { userId, name, targetAmount } = validatedData.data;
    
    // 1. Gera uma imagem inspiradora com IA.
    const imageHintResponse = await getChatbotInsightsResponse({
      query: `Gere uma ou duas palavras-chave em inglês para uma imagem que represente a meta financeira: "${name}"`,
      history: [],
      userId: userId,
    });
    
    const imageHint = imageHintResponse.success || name;
    const { imageUrl } = await generateGoalImage({ goalName: `${name} ${imageHint}` });

    const newGoalData = {
      userId,
      name,
      targetAmount,
      currentAmount: 0,
      imageUrl,
      imageHint: imageHint,
    };
    
    // 2. Salva o novo objetivo no Firestore.
    const goalsCol = collection(db, `users/${userId}/goals`);
    const docRef = await addDoc(goalsCol, newGoalData);

    revalidatePath('/goals');
    revalidatePath('/');
    
    const finalGoal: Goal = { id: docRef.id, ...newGoalData };
    return { success: finalGoal };

  } catch (e: any) {
    console.error('Erro na Server Action createGoalWithAIImage:', e);
    return { error: e.message || 'Não foi possível criar a meta com imagem.' };
  }
}

export async function deleteGoal(userId: string, goalId: string): Promise<{ success: boolean; error?: string }> {
    if(!goalId) {
        return { success: false, error: "ID da meta é obrigatório." };
    }
    try {
        const goalDocRef = doc(db, `users/${userId}/goals`, goalId);
        await deleteDoc(goalDocRef);
        revalidatePath("/goals");
        revalidatePath("/");
        return { success: true };
    } catch (e: any) {
        console.error(e);
        const errorMessage = e.message || "Ocorreu um erro inesperado ao deletar a meta.";
        return { success: false, error: errorMessage };
    }
}
