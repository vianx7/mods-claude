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

## Comandos

- `/clawd off`: desliga.
- `/clawd on`: liga de novo.

## Custo

- **Triagem:** uma chamada pequena (Haiku) em prompts de 8 palavras ou mais. Adiciona cerca de 1 segundo antes do envio.
- **Análise profunda:** só quando a triagem desconfia. Usa o modelo da sessão sobre a conversa em cache.

Tudo conta no seu plano. Se a triagem falhar ou demorar mais de 4 segundos, o prompt segue normalmente, sem a nota.

## Instalar

```
/plugin install clawd --marketplace vianx7/mods-claude
```
