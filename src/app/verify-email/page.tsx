// src/app/verify-email/page.tsx
'use client';

import { useState } from 'react';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { sendEmailVerification, signOut } from 'firebase/auth';
import { Loader2, MailCheck, LogOut } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

export default function VerifyEmailPage() {
    const { user } = useAuth();
    const { toast } = useToast();
    const router = useRouter();
    const [isSending, setIsSending] = useState(false);

    const handleResendVerification = async () => {
        if (!user) return;
        setIsSending(true);
        try {
            await sendEmailVerification(user);
            toast({
                title: "Email Enviado!",
                description: "Um novo link de verificação foi enviado para o seu email.",
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Falha ao Enviar",
                description: "Não foi possível enviar o email. Por favor, tente novamente mais tarde.",
            });
        } finally {
            setIsSending(false);
        }
    };

    const handleLogout = async () => {
        await signOut(auth);
        router.replace('/login');
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="mx-auto bg-primary/10 p-3 rounded-full w-fit mb-4">
                        <MailCheck className="h-8 w-8 text-primary" />
                    </div>
                    <CardTitle className="font-headline text-2xl">Verifique o seu Email</CardTitle>
                    <CardDescription>
                        Enviámos um link de confirmação para <strong>{user?.email || "o seu email"}</strong>. Por favor, clique no link para ativar a sua conta.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-center">
                    <p className="text-sm text-muted-foreground">
                        Após verificar, por favor, atualize esta página ou faça login novamente para aceder ao seu painel.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2 justify-center">
                        <Button onClick={handleResendVerification} disabled={isSending}>
                            {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Reenviar Email
                        </Button>
                         <Button variant="outline" onClick={handleLogout}>
                            <LogOut className="mr-2 h-4 w-4" />
                            Sair e Fazer Login
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
