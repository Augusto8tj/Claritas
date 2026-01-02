// /src/components/status/health-check-card.tsx
"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, AlertTriangle, Loader2, Settings } from "lucide-react";
import Link from "next/link";
import { useDerivApi } from "@/hooks/use-deriv-api";

type CheckResult = {
  success: boolean;
  error?: string;
};

interface HealthCheckCardProps {
  serviceName: string;
  description: string;
  successMessage: string;
  failureMessage: string;
  configurePath: string;
  checkResult?: CheckResult; // For server-side checks
  isClientSide?: boolean; // Flag for client-side checks
}

export function HealthCheckCard({
  serviceName,
  description,
  successMessage,
  failureMessage,
  configurePath,
  checkResult,
  isClientSide = false,
}: HealthCheckCardProps) {
  
  // Client-side state for the Deriv API check
  const { isConnected, isConnecting, connectionError, activeToken } = useDerivApi();
  
  // Generic state for display purposes
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [displayMessage, setDisplayMessage] = useState<string>("");

  useEffect(() => {
    if (isClientSide) {
      if (isConnecting) {
        setStatus("loading");
        setDisplayMessage("Verificando...");
      } else if (isConnected) {
        setStatus("success");
        setDisplayMessage(successMessage);
      } else {
        setStatus("error");
        if (!activeToken) {
           setDisplayMessage("Nenhum token (demo ou real) configurado no navegador.");
        } else {
           setDisplayMessage(connectionError || failureMessage);
        }
      }
    } else {
      // Logic for server-side checks (like Gemini)
      if (checkResult?.success) {
        setStatus("success");
        setDisplayMessage(successMessage);
      } else {
        setStatus("error");
        setDisplayMessage(checkResult?.error || failureMessage);
      }
    }
  }, [
      isClientSide, 
      checkResult, 
      isConnected, 
      isConnecting, 
      connectionError, 
      activeToken,
      successMessage, 
      failureMessage
  ]);


  const StatusInfo = () => {
    switch (status) {
      case "loading":
        return (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="font-semibold">Verificando...</p>
          </div>
        );
      case "success":
        return (
          <div className="flex items-center gap-3 text-green-600">
            <CheckCircle className="h-6 w-6" />
            <div>
                <p className="font-semibold">Conectado</p>
                <p className="text-xs text-green-600/80">{displayMessage}</p>
            </div>
          </div>
        );
      case "error":
        return (
          <div className="flex items-center gap-3 text-destructive">
            <XCircle className="h-6 w-6" />
             <div>
                <p className="font-semibold">Falha na Conexão</p>
                <p className="text-xs text-destructive/80">{displayMessage}</p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">{serviceName}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border bg-card p-4">
          <StatusInfo />
        </div>
      </CardContent>
      {status === 'error' && (
        <CardFooter>
          <Button asChild variant="outline">
            <Link href={configurePath}>
              <Settings className="mr-2 h-4 w-4" />
              Ir para Configurações
            </Link>
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
