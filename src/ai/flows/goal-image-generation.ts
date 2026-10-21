// src/ai/flows/goal-image-generation.ts
'use server';

/**
 * @fileOverview Generates an image for a financial goal using AI.
 *
 * - generateGoalImage - A function that generates an image based on a goal name.
 */

import { ai } from '@/lib/genkit';
import { GenerateGoalImageInputSchema, GenerateGoalImageOutputSchema, type GenerateGoalImageInput } from '@/lib/types';


const generateGoalImageFlow = ai.defineFlow(
  {
    name: 'generateGoalImageFlow',
    inputSchema: GenerateGoalImageInputSchema,
    outputSchema: GenerateGoalImageOutputSchema,
  },
  async ({ goalName }) => {
    const { media } = await ai.generate({
      model: 'googleai/imagen-4.0-fast-generate-001',
      prompt: `Generate a photorealistic, inspiring image for a financial goal titled "${goalName}". The image should be visually appealing and motivational.`,
    });

    if (!media?.url) {
      throw new Error('Image generation failed.');
    }

    return { imageUrl: media.url };
  }
);

export async function generateGoalImage(input: GenerateGoalImageInput) {
  return generateGoalImageFlow(input);
}
