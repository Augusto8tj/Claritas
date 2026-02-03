#!/bin/bash
# ATENÇÃO: Este script força o envio das suas alterações locais,
# sobrescrevendo o histórico do repositório remoto.
# Use com cuidado.

echo "A executar 'git push origin main --force' para forçar a atualização do repositório remoto..."
git push origin main --force

if [ $? -eq 0 ]; then
  echo "Push forçado concluído com sucesso! O repositório remoto agora espelha o seu estado local."
  # Apaga o script após o uso bem-sucedido, para evitar uso acidental.
  rm -- "$0"
else
  echo "O 'git push --force' falhou. Verifique a saída de erro acima."
  echo "Possíveis causas: falta de credenciais, token de acesso inválido ou repositório remoto não encontrado."
fi

