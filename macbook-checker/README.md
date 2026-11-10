# 💻 MacBook Checker

Teste um MacBook usado **antes de comprar**: teclado, tela, trackpad, alto-falantes, microfone, câmera, bateria, SSD e bloqueios de iCloud/empresa.

## Como usar

No Mac que você vai testar, abra o **Terminal** (⌘ Espaço → "Terminal") e cole:

```bash
curl -fsSL https://raw.githubusercontent.com/vianx7/mods-claude/main/macbook-checker/install.sh | bash
```

> **Dica para não digitar o comando:** no Mac, abra o Safari em `github.com/vianx7/mods-claude`, clique no botão de copiar ao lado do comando e cole no Terminal.

O script lê o hardware do Mac, abre a página de testes no navegador e você vai seguindo o menu da esquerda. No final, o **Relatório** junta tudo (dá para copiar ou salvar em PDF). Quando terminar, aperte `Ctrl+C` no terminal.

Nada é instalado no Mac: os arquivos ficam numa pasta temporária, um servidorzinho em Perl (que já vem no macOS) roda só em `127.0.0.1` enquanto o terminal estiver aberto, e nenhum dado sai do computador.

## O que ele testa

| Teste | Como |
| --- | --- |
| 🧾 Sistema e bateria | Modelo, chip, RAM, SSD, nº de série, **ciclos e saúde da bateria**, **S.M.A.R.T. do SSD**, **Bloqueio de Ativação (iCloud)** e **MDM (Mac de empresa)**, com alertas automáticos |
| ⌨️ Teclado | Teclado desenhado na tela; cada tecla apertada fica verde e mostra o progresso |
| 🖥️ Tela e cores | Tela cheia em preto, branco, RGB, cinzas, degradê e xadrez para achar pixels mortos, manchas e vazamento de luz |
| 👆 Trackpad | Mapa de cobertura (acha pontos mortos), clique, duplo clique, clique secundário, arrastar, rolagem, pinça e Force Touch |
| 🔊 Alto-falantes | **Música de teste** que você joga para só o esquerdo, só o direito ou os dois (ou alterna sozinha), para ouvir chiado e "rasgado"; varredura grave→agudo |
| 🎙️ Microfone | Medidor de nível + grava 5 s e toca de volta |
| 📷 Câmera | Imagem ao vivo |
| 🔌 Portas e físico | **Ao vivo:** mostra se está na tomada, a % e os watts do carregador, e os aparelhos USB plugados — pluga em cada porta e vê. Mais uma lista guiada: MagSafe, fone, Bluetooth, Touch ID, Touch Bar, luz do teclado, dobradiça, carcaça, líquido, Apple Diagnostics, conta iCloud |

**Avançado (deixe para o final):**

| Teste | Como |
| --- | --- |
| 💥 Travamentos | Procura registros de *kernel panic* (Mac que trava e reinicia sozinho) e mostra há quanto tempo o macOS foi configurado |
| 📶 Velocidade Wi-Fi | Usa o `networkQuality` da Apple (macOS 12+) |
| 💾 Velocidade do SSD | Grava 2 GB, mede e apaga. M1 normal: acima de 1.500 MB/s |
| 🔥 Teste de estresse | Todos os núcleos no máximo por 90 s; Mac com defeito costuma travar aqui |

## Sem terminal?

Abra o `index.html` direto no navegador: os testes básicos funcionam, mas "Sistema e bateria", as portas ao vivo e os avançados ficam sem dados (veja em  → Sobre Este Mac → Relatório do Sistema).
