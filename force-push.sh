#!/bin/bash

# AVISO: operação DESTRUTIVA. Sobrescreve a branch remota com o seu histórico local.
# ETAPA 29: usa --force-with-lease (recusa se o remoto tiver commits que você não viu) e exige digitar o nome da branch.

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "🚨 ATENÇÃO: você vai SOBRESCREVER 'origin/${BRANCH}' com o histórico local."
echo "Commits remotos que não estão na sua máquina serão perdidos."
echo ""
git fetch origin "${BRANCH}" 2>/dev/null
echo "Diferença (local vs remoto):"
git log --oneline "origin/${BRANCH}..HEAD" 2>/dev/null | head -20
echo ""
read -p "Digite o nome da branch (${BRANCH}) para confirmar: " CONFIRM

if [ "$CONFIRM" = "$BRANCH" ]; then
    echo "🚀 git push origin ${BRANCH} --force-with-lease"
    git push origin "${BRANCH}" --force-with-lease
    if [ $? -eq 0 ]; then
        echo "✅ Push concluído."
    else
        echo "❌ Falha (o remoto mudou desde o último fetch, ou falta autenticação). Nada foi sobrescrito."
    fi
else
    echo "Operação cancelada."
fi
