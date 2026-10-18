// /src/components/settings/email-notifications-card.tsx
"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { sendFinancialSummaryEmail } from "@/app/actions";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/features/auth/hooks/use-auth";

export function EmailNotificationsCard() {
    const { user } = useAuth();
    const [isSending, setIsSending] = useState(false);
    const { toast } = useToast();

    const handleSendTestEmail = async () => {
        if (!user || !user.email) {
            toast({ variant: "destructive", title: "Erro", description: "Utilizador não autenticado ou sem email." });
            return;
        }

        setIsSending(true);
        // Enviando com resumo financeiro zerado para o teste manual
        const result = await sendFinancialSummaryEmail(user.uid, user.email, { income: 0, expenses: 0, balance: 0 });
        setIsSending(false);

        if (result.success) {
            toast({
                title: "Email de Teste Enviado",
                description: "Verifique o console do seu navegador/servidor para ver a simulação.",
            });
        } else {
            toast({
                variant: "destructive",
                title: "Falha no Envio",
                description: (result as any).error || "Não foi possível enviar o email de teste.",
            });
        }
    }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Notificações</CardTitle>
        <CardDescription>
          Gerencie como você recebe notificações do aplicativo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
          <div className="space-y-0.5">
            <Label htmlFor="email-notifications">Notificações por Email</Label>
            <p className="text-sm text-muted-foreground">
              Receba insights e alertas importantes por email.
            </p>
          </div>
          <Switch id="email-notifications" defaultChecked />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
          <div className="space-y-0.5">
            <Label htmlFor="push-notifications">Notificações Push</Label>
            <p className="text-sm text-muted-foreground">
              Receba alertas em tempo real no seu dispositivo.
            </p>
          </div>
          <Switch id="push-notifications" />
        </div>
         <Separator className="my-4" />
         <div className="space-y-2 pt-2">
            <Label>Teste de Notificação</Label>
            <p className="text-sm text-muted-foreground pb-2">
                Envie um email de teste para verificar a funcionalidade. Em um app real, isso enviaria um email de verdade. Aqui, ele apenas registrará no console.
            </p>
            <Button onClick={handleSendTestEmail} disabled={isSending || !user} variant="outline">
                {isSending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                    <Mail className="mr-2 h-4 w-4" />
                )}
                Enviar Email de Teste
            </Button>
         </div>
      </CardContent>
    </Card>
  );
}

