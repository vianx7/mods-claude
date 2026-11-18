import type { Register } from 'claude-code'

// O Clawd agora mora dentro do usage-band (na mesma linha da faixa).
// Este plugin ficou só para avisar quem ainda o tem instalado.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      if ((await $.store.get('moved-notice')) !== true) {
        await $.store.set('moved-notice', true)
        $.ui.toast('🦀 O Clawd agora vem dentro do usage-band. Pode desinstalar este: claude plugin uninstall clawd@mods-claude', { timeoutMs: 12000 })
      }
    } catch {}
    return result
  })
}
