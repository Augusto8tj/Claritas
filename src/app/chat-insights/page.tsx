// /src/app/chat-insights/page.tsx
import { ChatInterfaceInsights } from "@/components/chat-insights/chat-interface-insights";

export default function ChatInsightsPage() {
  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          Chat IA Claritas
        </h1>
      </div>
      <p className="text-muted-foreground">
        Converse com uma versão da Claritas que pode acessar seus dados.
      </p>
      <div className="h-[calc(100vh-14rem)]">
        <ChatInterfaceInsights />
      </div>
    </div>
  );
}
