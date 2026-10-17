
#!/bin/bash

# AVISO: Este script irá forçar o envio das suas alterações locais,
# sobrescrevendo o branch 'main' no GitHub. Use com cuidado.

echo "🚨 ATENÇÃO: Esta é uma operação destrutiva."
echo "Isto irá substituir permanentemente o branch 'main' no GitHub com o seu histórico local."
echo "Qualquer alteração que exista no GitHub mas não na sua máquina será perdida."
echo ""
read -p "Tem a certeza que deseja forçar o push para 'main'? (s/N) " -n 1 -r
echo    # Move para uma nova linha

if [[ $REPLY =~ ^[Ss]$ ]]
then
    echo ""
    echo "🚀 Forçando o push... (git push origin main --force)"
    git push origin main --force

    if [ $? -eq 0 ]; then
        echo "✅ Push forçado concluído com sucesso!"
        # Auto-destruição removida para permitir reuso se necessário, 
        # mas adicionado aviso de conclusão.
    else
        echo "❌ Falha no push forçado. Verifique se você configurou seu Personal Access Token (PAT)."
    fi
else
    echo "Operação cancelada."
fi
