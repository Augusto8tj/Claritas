// /src/lib/genkit.ts
import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

// Define model names for consistency. 
const flash = 'googleai/gemini-2.5-flash';
const flashLite = 'googleai/gemini-2.5-flash-lite';
const pro = 'googleai/gemini-pro';


export const ai = genkit({
  plugins: [
    googleAI(),
  ],
  // Set the default, most economical model to avoid rate limiting.
  model: pro,
});

// Re-exporting for use in other server components, though direct usage is preferred.
export { flash, flashLite, pro };
