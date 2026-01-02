// /src/ai/dev.ts
import { config } from 'dotenv';
config();

// O único fluxo ativo agora é o chatbot principal, que usa todas as outras lógicas como ferramentas.
import '@/ai/flows/financial-chatbot-insights';
