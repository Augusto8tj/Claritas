
import { AICopilotDashboard } from "@/features/ai-copilot/components/ai-copilot-dashboard";

export const metadata = {
  title: 'AI Copilot | Claritas',
  description: 'Seu consultor de inteligência artificial para finanças e trading.',
};

export default function AICopilotPage() {
  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <AICopilotDashboard />
    </div>
  );
}
