# 🦀 Clawd: o caranguejo observador

O Clawd acompanha suas conversas com o Claude Code em silêncio e só aparece quando é **crucial**.

Ele foi feito para quem **dita os prompts por voz**: entende vícios de fala ("tipo", "né", "aí", "mano"), frases recomeçadas e erros de transcrição, e não trata nada disso como problema.

## O que ele faz

1. **Entende o ditado.** Antes de enviar, uma triagem rápida lê o prompt junto com o trecho recente da conversa. Se a transcrição estiver confusa a ponto de o Claude poder entender errado, o Clawd anexa a interpretação limpa do que você quis dizer. O seu texto original nunca é alterado.
2. **Desconfia só do que importa.** A triagem marca para análise apenas:
   - um erro de transcrição que muda o sentido de uma ação ("deletar" vs "deployar");
   - uma ambiguidade que faria o Claude construir a coisa errada;
   - uma contradição com algo combinado antes;
   - uma ação destrutiva que parece pedida por engano;
   - uma informação faltando sem a qual o trabalho será desperdiçado.
3. **Pensa com a conversa inteira.** Quando algo é marcado, ele faz, em segundo plano, uma análise profunda com toda a conversa (servida do cache) e o mesmo modelo da sessão. Ele é conservador: na dúvida, fica quieto.
4. **Avisa em uma linha**, acima da caixa de texto, e manda uma notificação:

   ```
   🦀 Clawd: Você disse deletar, mas a conversa toda é sobre fazer deploy.   [Parar e corrigir]  Ignorar
   ```

   - **Parar e corrigir:** interrompe o Claude e reenvia o prompt corrigido.
   - **Usar correção:** aparece quando o Claude já terminou e põe o prompt corrigido na caixa de texto para você revisar.
   - **Ignorar:** some com o aviso.

Fora disso ele fica invisível. Se você usa o `usage-band`, a faixa de uso cede a linha só enquanto o alerta está aberto.

## Economia de tokens

O Clawd foi feito para gastar pouco e te ajudar a gastar menos.

- **Pré-filtro grátis (modo Economia, o padrão).** Antes de chamar qualquer modelo, uma checagem local decide se vale a pena. A triagem só roda quando o prompt tem cara de ditado bagunçado (vícios de fala, sem pontuação, palavras repetidas) ou fala de algo arriscado (apagar, deploy, produção, push, migração, pagamento…). Prompt limpo passa direto, de graça.
- **Triagem enxuta.** Quando roda, usa o Haiku com só as últimas 3 mensagens, cortadas.
- **Segura o envio em conversa grande e fria.** Se faz mais de 1 hora desde a última resposta e a conversa tem 40 mil tokens ou mais, mandar uma mensagem relê tudo sem o desconto do cache. O Clawd segura o envio e pergunta:
  ```
  🦀 Clawd: Conversa fria e grande (~120k tokens): enviar agora relê tudo sem desconto.   [Compactar e enviar]  Enviar assim  Ignorar
  ```
  - **Compactar e enviar:** resume a conversa antes, e as próximas mensagens ficam bem mais leves.
  - **Enviar assim:** manda do jeito que está.
  - **Ignorar:** devolve o texto para a caixa.

## Menu (clique no 🦀)

O 🦀 fica no fim da linha da faixa de uso. Clicando nele, abre um painel ao lado do chat com:

- **Ligar / Desligar.**
- **Modo:**
  - **Economia** (padrão): pré-filtro grátis.
  - **Sempre:** todo prompt seu com 8 ou mais palavras passa pela triagem.
  - **Só grátis:** nunca chama modelo; só o aviso de conversa fria.
- **Economia de tokens:** liga ou desliga o aviso de conversa fria e tem o botão *Compactar conversa agora*.
- **Quanto o Clawd gastou:** triagens, quantas foram puladas de graça, análises profundas e tokens aproximados.
- **Últimos avisos** que ele deu.
- **Em breve:** espaço para as próximas features.

## Comandos

- `/clawd`: abre o menu.
- `/clawd off`: desliga.
- `/clawd on`: liga de novo.

## Custo

- **Pré-filtro e aviso de conversa fria:** grátis, não chamam modelo.
- **Triagem:** uma chamada pequena (Haiku), só quando o pré-filtro manda. Adiciona cerca de 1 segundo antes do envio.
- **Análise profunda:** só quando a triagem desconfia. Usa o modelo da sessão sobre a conversa em cache.

Tudo conta no seu plano, e o menu mostra quanto ele gastou. Se a triagem falhar ou demorar mais de 4 segundos, o prompt segue normalmente.

## Instalar

```
/plugin install clawd --marketplace vianx7/mods-claude
```
