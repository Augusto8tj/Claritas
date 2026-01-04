// /src/features/auth/components/login-form.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose
} from "@/components/ui/dialog";

const formSchema = z.object({
  email: z.string().email("Por favor, insira um email válido."),
  password: z.string().min(1, "A senha não pode estar vazia."),
});

type FormValues = z.infer<typeof formSchema>;

const resetSchema = z.object({
    email: z.string().email("Por favor, insira um email válido para redefinir a senha."),
});
type ResetFormValues = z.infer<typeof resetSchema>;

function ForgotPasswordDialog() {
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const { toast } = useToast();

    const form = useForm<ResetFormValues>({
        resolver: zodResolver(resetSchema),
        defaultValues: { email: "" },
    });

    const onSubmit: SubmitHandler<ResetFormValues> = async (data) => {
        setLoading(true);
        try {
            await sendPasswordResetEmail(auth, data.email);
            setSent(true);
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Falha ao Enviar Email",
                description: error.code === 'auth/user-not-found' 
                    ? "Nenhum utilizador encontrado com este email."
                    : "Ocorreu um erro. Por favor, tente novamente.",
            });
        } finally {
            setLoading(false);
        }
    };
    
    if (sent) {
        return (
             <div className="text-center space-y-4">
                <p className="text-sm text-muted-foreground">
                    Se uma conta com este email existir, um link para redefinição de senha foi enviado. Por favor, verifique a sua caixa de entrada.
                </p>
                <DialogClose asChild>
                    <Button>Fechar</Button>
                </DialogClose>
            </div>
        )
    }

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Email de Recuperação</FormLabel>
                            <FormControl>
                                <Input placeholder="voce@exemplo.com" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="ghost">Cancelar</Button>
                    </DialogClose>
                    <Button type="submit" disabled={loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Enviar Link
                    </Button>
                </DialogFooter>
            </form>
        </Form>
    )
}

export function LoginForm() {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, data.email, data.password);
      // O redirecionamento será tratado pelo AuthGuard
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Falha no Login",
        description: "Email ou senha incorretos. Por favor, tente novamente.",
      });
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input placeholder="voce@exemplo.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Senha</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end">
                <Dialog>
                    <DialogTrigger asChild>
                        <Button variant="link" size="sm" className="h-auto p-0 text-xs">Esqueceu-se da senha?</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle className="font-headline">Redefinir Senha</DialogTitle>
                            <DialogDescription>
                                Insira o seu email para receber um link de redefinição de senha.
                            </DialogDescription>
                        </DialogHeader>
                        <ForgotPasswordDialog />
                    </DialogContent>
                </Dialog>
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Entrar
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="p-6 pt-0">
          <p className="text-sm text-center w-full text-muted-foreground">
            Não tem uma conta?{" "}
            <Link href="/signup" className="text-primary hover:underline font-semibold">
              Cadastre-se
            </Link>
          </p>
      </CardFooter>
    </Card>
  );
}
