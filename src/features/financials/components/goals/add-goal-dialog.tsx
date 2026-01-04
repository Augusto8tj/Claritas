// /src/features/financials/components/goals/add-goal-dialog.tsx
"use client";

import { useState } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { addGoal } from "@/app/actions/financial-data-actions";
import { useToast } from "@/hooks/use-toast";
import type { Goal } from "@/lib/types";
import { useAuth } from "@/features/auth/hooks/use-auth";

interface AddGoalDialogProps {
    onGoalAdded: (goal: Goal) => void;
}

const formSchema = z.object({
  name: z.string().min(1, "O nome da meta é obrigatório."),
  targetAmount: z.coerce.number().positive("O valor da meta deve ser positivo."),
});

type FormValues = z.infer<typeof formSchema>;

export function AddGoalDialog({ onGoalAdded }: AddGoalDialogProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      targetAmount: 1000,
    },
  });

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    if (!user) {
      toast({ variant: "destructive", title: "Erro", description: "Utilizador não autenticado." });
      return;
    }
    setLoading(true);
    const response = await addGoal({ userId: user.uid, ...data });
    
    if (response.error) {
       if(typeof response.error === 'object') {
        Object.entries(response.error).forEach(([key, value]) => {
          form.setError(key as keyof FormValues, { message: (value as string[])[0] });
        });
      } else {
         toast({
            variant: "destructive",
            title: "Falha ao Adicionar Meta",
            description: response.error,
        });
      }
    } else if (response.success) {
      toast({
        title: "Meta Adicionada!",
        description: `A meta "${response.success.name}" foi criada.`,
      });
      onGoalAdded(response.success);
      setOpen(false);
      form.reset();
    }
    setLoading(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      form.reset();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" />
          Adicionar Nova Meta
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="font-headline">Criar Nova Meta</DialogTitle>
          <DialogDescription>
            Defina um novo objetivo financeiro para acompanhar.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome da Meta</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Viagem para a Europa" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="targetAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Valor da Meta (R$)</FormLabel>
                  <FormControl>
                    <Input type="number" {...field} />
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
                Salvar Meta
                </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
