#!/bin/bash

# Este script atualiza o seu branch local com as mudanças do repositório remoto.
# Ele usa 'git pull --rebase' para evitar um "merge commit" desnecessário, mantendo o histórico limpo.

echo ""
echo "🔄  A sincronizar com as atualizações remotas..."
echo "    Executando: git pull --rebase"
echo ""

# Puxa as mudanças remotas e reaplica os commits locais por cima
git pull --rebase

# Verifica se o pull foi bem-sucedido
if [ $? -eq 0 ]; then
    echo ""
    echo "✅  Sincronização concluída com sucesso."
    echo "    Agora você pode tentar executar 'git push' novamente."
    echo ""
else
    echo ""
    echo "❌  Ocorreu um erro durante a sincronização."
    echo "    Pode haver conflitos de merge que precisam ser resolvidos manualmente."
    echo "    Por favor, verifique o status do git com 'git status' e resolva os conflitos antes de continuar."
    echo ""
    # Não se autodestrói se houver um erro, para que o utilizador possa ver o que foi executado.
    exit 1
fi

# Auto-destruição do script para segurança
echo "Removendo este script de ajuda para evitar uso acidental..."
rm -- "$0"
