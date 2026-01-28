#!/bin/bash
# Script para resolver o erro "non-fast-forward" do git push.

# Passo 1: Baixar e integrar as alterações do repositório remoto.
# Isto sincroniza o seu trabalho local com o que está no GitHub.
echo "A executar 'git pull origin main' para sincronizar com o repositório remoto..."
git pull origin main

# Verifica se o pull foi bem-sucedido antes de continuar.
if [ $? -ne 0 ]; then
  echo "O 'git pull' falhou. Por favor, resolva os conflitos de merge ou erros e tente novamente."
  exit 1
fi

echo "Sincronização bem-sucedida."
echo ""

# Passo 2: Enviar as suas alterações agora que a branch está atualizada.
echo "A executar 'git push origin main' para enviar as suas alterações..."
git push origin main

if [ $? -eq 0 ]; then
  echo "Push concluído com sucesso!"
  # Apaga o script após o uso bem-sucedido.
  rm -- "$0"
else
  echo "O 'git push' falhou. Verifique a saída de erro acima."
fi
