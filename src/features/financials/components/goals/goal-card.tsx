// /src/features/financials/components/goals/goal-card.tsx
"use client";

import Image from "next/image";
import * as React from "react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { GoalProjectionDialog } from "@/components/goals/goal-projection-dialog";
import type { Goal } from "@/lib/types";
import { Trash2, Loader2, Image as ImageIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { deleteGoal } from "@/services/financial-data-service";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { generateGoalImage } from "@/ai/flows/goal-image-generation";
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface GoalCardProps {
  goal: Goal;
  onGoalDeleted: (goalId: string) => void;
}

export function GoalCard({ goal, onGoalDeleted }: GoalCardProps) {
  const { user } = useAuth();
  const progress = (goal.currentAmount / goal.targetAmount) * 100;
  const { toast } = useToast();
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = React.useState(false);
  const [imageUrl, setImageUrl] = React.useState(goal.imageUrl);

  const handleDelete = async () => {
    if (!user) {
      toast({ variant: "destructive", title: "Erro", description: "Utilizador não autenticado." });
      return;
    }
    setIsDeleting(true);
    try {
      await deleteGoal(user.uid, goal.id); // Chama a função do serviço
      toast({
        title: "Meta Deletada",
        description: `A meta "${goal.name}" foi removida.`,
      });
      onGoalDeleted(goal.id);
    } catch (error: any) {
       toast({
        variant: "destructive",
        title: "Erro ao Deletar",
        description: error.message || "Não foi possível deletar a meta.",
      });
    } finally {
      setIsDeleting(false);
    }
  };


  const handleGenerateImage = async () => {
    if (!user) return;
    setIsGeneratingImage(true);
    try {
      const result = await generateGoalImage({ goalName: goal.name });
      if (result.imageUrl) {
        setImageUrl(result.imageUrl);
        const goalDocRef = doc(db, 'users', user.uid, 'goals', goal.id);
        await updateDoc(goalDocRef, { imageUrl: result.imageUrl });
        toast({ title: "Imagem Gerada!", description: "A imagem da sua meta foi atualizada." });
      } else {
        throw new Error("A API não retornou uma imagem.");
      }
    } catch (error) {
      console.error("Falha ao gerar imagem:", error);
      toast({ variant: "destructive", title: "Erro de IA", description: "Não foi possível gerar a imagem da meta." });
    } finally {
      setIsGeneratingImage(false);
    }
  };


  return (
    <Card className="flex flex-col">
      <CardHeader className="p-0 relative">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2 z-10 h-8 w-8"
              aria-label="Deletar meta"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação não pode ser desfeita. Isso irá deletar permanentemente a meta
                "{goal.name}".
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
                {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Deletar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="relative h-40 w-full">
          <Image
            src={imageUrl}
            alt={goal.name}
            fill={true}
            style={{objectFit: 'cover'}}
            className="rounded-t-lg bg-muted"
            data-ai-hint={goal.imageHint}
            unoptimized={imageUrl.startsWith('data:image')} // Desativa otimização para data URIs
          />
        </div>
        <div className="p-6 pb-2">
            <CardTitle className="font-headline text-xl">{goal.name}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex-grow space-y-4">
        <div className="space-y-2">
          <Progress value={progress} />
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>R${goal.currentAmount.toLocaleString('pt-BR')}</span>
            <span>R${goal.targetAmount.toLocaleString('pt-BR')}</span>
          </div>
        </div>
        <Button variant="secondary" className="w-full" onClick={handleGenerateImage} disabled={isGeneratingImage}>
          {isGeneratingImage ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <ImageIcon className="mr-2 h-4 w-4"/>}
          {isGeneratingImage ? "A criar..." : "Gerar Nova Imagem com IA"}
        </Button>
      </CardContent>
      <CardFooter>
        <GoalProjectionDialog goal={goal} />
      </CardFooter>
    </Card>
  );
}
    