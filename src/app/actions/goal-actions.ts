// src/app/actions/goal-actions.ts
'use server';

import { z } from 'zod';
import { generateGoalImage } from '@/ai/flows/goal-image-generation';
import { getChatbotInsightsResponse } from '@/app/actions';

const addGoalSchema = z.object({
  userId: z.string(),
  name: z.string().min(1, 'O nome da meta é obrigatório.'),
});

// Ação renomeada e simplificada: agora só gera dados, não salva.
export async function generateGoalDataWithAIImage(data: { userId: string; name: string }): Promise<{ success?: { imageUrl: string; imageHint: string }, error?: any }> {
  const validatedData = addGoalSchema.safeParse(data);
  if (!validatedData.success) {
    return { error: validatedData.error.flatten().fieldErrors };
  }

  try {
    const { userId, name } = validatedData.data;
    
    // 1. Gera uma dica para a imagem com IA.
    const imageHintResponse = await getChatbotInsightsResponse({
      query: `Gere uma ou duas palavras-chave em inglês para uma imagem que represente a meta financeira: "${name}"`,
      history: [],
      userId: userId,
    });
    
    const imageHint = imageHintResponse.success || name;
    
    // 2. Gera a imagem inspiradora com IA.
    const { imageUrl } = await generateGoalImage({ goalName: `${name} ${imageHint}` });

    // 3. Retorna os dados gerados pela IA para o cliente.
    return { success: { imageUrl, imageHint } };

  } catch (e: any) {
    console.error('Erro na Server Action generateGoalDataWithAIImage:', e);
    return { error: e.message || 'Não foi possível gerar a imagem da meta.' };
  }
}
    