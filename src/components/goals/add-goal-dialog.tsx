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
import { generateGoalDataWithAIImage } from "@/app/actions/goal-actions";
import { saveGoal } from "@/services/financial-data-service";
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
    
    try {
        // 1. Chama a Server Action para gerar dados da imagem
        const imageResponse = await generateGoalDataWithAIImage({ userId: user.uid, name: data.name });

        if (imageResponse.error || !imageResponse.success) {
            throw new Error(imageResponse.error || "A IA não conseguiu gerar uma imagem para a meta.");
        }

        const { imageUrl, imageHint } = imageResponse.success;
        
        // 2. Prepara o objeto completo da meta
        const goalData = {
            name: data.name,
            targetAmount: data.targetAmount,
            currentAmount: 0,
            imageUrl,
            imageHint,
        };

        // 3. Chama a função do serviço (no cliente) para salvar no Firestore
        const newGoal = await saveGoal(user.uid, goalData);

        toast({
            title: "Meta Adicionada!",
            description: `A meta "${newGoal.name}" foi criada com uma imagem gerada por IA.`,
        });
        onGoalAdded(newGoal);
        setOpen(false);
        form.reset();

    } catch (error: any) {
        console.error("Erro no processo de criação de meta:", error);
        toast({
            variant: "destructive",
            title: "Falha ao Adicionar Meta",
            description: error.message || "Ocorreu um erro inesperado.",
        });
    } finally {
        setLoading(false);
    }
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
            Defina um novo objetivo financeiro. A IA irá gerar uma imagem inspiradora para si!
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