// /src/app/settings/page.tsx
import { EmailNotificationsCard } from "@/features/auth/components/settings/email-notifications-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemeSelector } from "@/features/theme/components/theme-selector";
import { FontSelector } from "@/features/theme/components/font-selector";
import { Separator } from "@/components/ui/separator";
import { ApiKeysCard } from "@/features/trading/components/settings/api-keys-card";

export default function SettingsPage() {
  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <h1 className="text-3xl font-bold tracking-tight font-headline">
        Configurações
      </h1>
      
      <ApiKeysCard />
      <EmailNotificationsCard />

      <Card>
        <CardHeader>
          <CardTitle className="font-headline">Aparência</CardTitle>
          <CardDescription>
            Personalize a aparência do aplicativo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
           <ThemeSelector />
           <Separator />
           <FontSelector />
        </CardContent>
      </Card>
    </div>
  );
}
