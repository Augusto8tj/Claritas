// /src/components/budget/edit-budget-dialog.tsx
"use client";

import { useState } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
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
import { updateBudget } from "@/app/actions/budget-actions";
import { useToast } from "@/hooks/use-toast";
import type { BudgetCategory } from "@/lib/types";
import { useAuth } from "@/features/auth/hooks/use-auth";

interface EditBudgetDialogProps {
    category: BudgetCategory;
    onBudgetUpdated: (category: BudgetCategory) => void;
    children: React.ReactNode;
}

const formSchema = z.object({
  budgeted: z.coerce.number().min(0, "O valor do orçamento não pode ser negativo."),
});

type FormValues = z.infer<typeof formSchema>;

export function EditBudgetDialog({ category, onBudgetUpdated, children }: EditBudgetDialogProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      budgeted: category.budgeted,
    },
  });

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    if (!user) {
      toast({ variant: "destructive", title: "Erro", description: "Utilizador não autenticado." });
      return;
    }

    setLoading(true);
    const response = await updateBudget({ userId: user.uid, name: category.name, budgeted: data.budgeted });
    
    if (response.error) {
       if(typeof response.error === 'object') {
        Object.entries(response.error).forEach(([key, value]) => {
          form.setError(key as keyof FormValues, { message: (value as string[])[0] });
        });
      } else {
         toast({
            variant: "destructive",
            title: "Falha ao Atualizar Orçamento",
            description: response.error,
        });
      }
    } else if (response.success) {
      toast({
        title: "Orçamento Atualizado!",
        description: `O limite para "${response.success.name}" foi atualizado.`,
      });
      onBudgetUpdated(response.success);
      setOpen(false);
    }
    setLoading(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      form.reset({
        budgeted: category.budgeted,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="font-headline">Editar Limite para {category.name}</DialogTitle>
          <DialogDescription>
            Ajuste o valor máximo que você planeja gastar nesta categoria por mês.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="budgeted"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Novo Limite (R$)</FormLabel>
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
                Salvar
                </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
