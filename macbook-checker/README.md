# 💻 MacBook Checker

Teste um MacBook usado **antes de comprar**: teclado, tela, trackpad, alto-falantes, microfone, câmera, bateria, SSD e bloqueios de iCloud/empresa.

## Como usar

No Mac que você vai testar, abra o **Terminal** (⌘ Espaço → "Terminal") e cole:

```bash
curl -fsSL https://raw.githubusercontent.com/vianx7/mods-claude/main/macbook-checker/install.sh | bash
```

O script lê o hardware do Mac, abre a página de testes no navegador e você vai seguindo o menu da esquerda. No final, o **Relatório** junta tudo (dá para copiar ou salvar em PDF). Quando terminar, aperte `Ctrl+C` no terminal.

Nada é instalado no Mac: os arquivos ficam numa pasta temporária e nenhum dado sai do computador.

## O que ele testa

| Teste | Como |
| --- | --- |
| 🧾 Sistema e bateria | Modelo, chip, RAM, SSD, nº de série, **ciclos e saúde da bateria**, **S.M.A.R.T. do SSD**, **Bloqueio de Ativação (iCloud)** e **MDM (Mac de empresa)**, com alertas automáticos |
| ⌨️ Teclado | Teclado desenhado na tela; cada tecla apertada fica verde e mostra o progresso |
| 🖥️ Tela e cores | Tela cheia em preto, branco, RGB, cinzas, degradê e xadrez para achar pixels mortos, manchas e vazamento de luz |
| 👆 Trackpad | Mapa de cobertura (acha pontos mortos), clique, duplo clique, clique secundário, arrastar, rolagem, pinça e Force Touch |
| 🔊 Alto-falantes | Esquerdo, direito, os dois, varredura grave→agudo para ouvir chiado de alto-falante estourado |
| 🎙️ Microfone | Medidor de nível + grava 5 s e toca de volta |
| 📷 Câmera | Imagem ao vivo |
| 🔌 Portas e físico | Lista guiada: carregamento, portas USB-C, MagSafe, fone, Wi-Fi, Bluetooth, Touch ID, luz do teclado, dobradiça, carcaça, antirreflexo, ventoinha, conta iCloud |

## Sem terminal?

Abra o `index.html` direto no navegador: todos os testes funcionam, só a parte "Sistema e bateria" fica sem os dados (veja em  → Sobre Este Mac → Relatório do Sistema).
