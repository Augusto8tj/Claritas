// /src/lib/genkit.ts
import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

// Define model names for consistency. 
const flash = 'googleai/gemini-2.5-flash';
const flashLite = 'googleai/gemini-2.5-flash-lite';


export const ai = genkit({
  plugins: [
    googleAI(),
  ],
  // Set the default, fast, and economical model
  model: flashLite,
});

// Re-exporting for use in other server components, though direct usage is preferred.
export { flash, flashLite };
