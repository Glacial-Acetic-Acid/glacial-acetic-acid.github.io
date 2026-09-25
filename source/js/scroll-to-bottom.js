(() => {
  const mountScrollToBottom = () => {
    const goUp = document.querySelector('#rightside-config-show #go-up')
    if (!goUp || document.getElementById('go-down')) return

    const button = document.createElement('button')
    button.id = 'go-down'
    button.type = 'button'
    button.title = '回到底部'
    button.setAttribute('aria-label', '回到底部')

    const icon = document.createElement('i')
    icon.className = 'fas fa-arrow-down'
    icon.setAttribute('aria-hidden', 'true')
    button.appendChild(icon)

    button.addEventListener('click', () => {
      const pageHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.scrollTo({ top: pageHeight, behavior: reducedMotion ? 'auto' : 'smooth' })
    })

    goUp.insertAdjacentElement('afterend', button)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountScrollToBottom, { once: true })
  } else {
    mountScrollToBottom()
  }

  document.addEventListener('pjax:complete', mountScrollToBottom)
})()
