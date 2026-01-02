// /src/app/settings/page.tsx
import { EmailNotificationsCard } from "@/components/settings/email-notifications-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemeSelector } from "@/components/settings/theme-selector";
import { FontSelector } from "@/components/settings/font-selector";
import { Separator } from "@/components/ui/separator";
import { ApiKeysCard } from "@/components/settings/api-keys-card";

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
