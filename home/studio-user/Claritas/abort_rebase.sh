#!/bin/bash

# Este script aborta uma operação de 'git rebase' em andamento.
# É uma ação segura que reverte o repositório para o estado anterior ao início do rebase.

echo "⚠️  Operação 'git rebase' em andamento detectada."
echo "Isto pode acontecer se uma atualização anterior foi interrompida."
echo ""
echo "Estou a abortar a operação de rebase para restaurar o estado normal do seu repositório."
echo "Executando: git rebase --abort"
echo ""

# Aborta o rebase
git rebase --abort

echo ""
echo "✅  Operação abortada com sucesso. O seu repositório voltou ao estado normal."
echo "    O prompt do terminal deve voltar a exibir o nome do branch (ex: 'main')."
echo ""

# Auto-destruição do script para segurança
echo "Removendo este script para evitar uso acidental..."
rm -- "$0"
