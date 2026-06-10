import { useEffect, useRef } from 'react'

export default function OceanBackground() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId, t = 0

    function resize() {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    function draw() {
      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)

      // Deep void gradient — warm charcoal, not cold blue
      const grad = ctx.createLinearGradient(0, 0, 0, height)
      grad.addColorStop(0,   '#080c14')
      grad.addColorStop(0.5, '#0e1420')
      grad.addColorStop(1,   '#131b2e')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, width, height)

      // Subtle gold ambient glow — bottom left
      const amb = ctx.createRadialGradient(width * 0.15, height * 0.85, 0, width * 0.15, height * 0.85, width * 0.5)
      amb.addColorStop(0,   'rgba(201, 169, 110, 0.06)')
      amb.addColorStop(0.5, 'rgba(201, 169, 110, 0.02)')
      amb.addColorStop(1,   'rgba(201, 169, 110, 0)')
      ctx.fillStyle = amb
      ctx.fillRect(0, 0, width, height)

      // Very subtle wave lines — gold-tinted
      for (let i = 0; i < 3; i++) {
        ctx.beginPath()
        ctx.strokeStyle = `rgba(201, 169, 110, ${0.028 - i * 0.007})`
        ctx.lineWidth = 1
        for (let x = 0; x <= width; x += 4) {
          const y = height * (0.3 + i * 0.22) + Math.sin((x / width) * Math.PI * 4 + t + i * 1.4) * 5
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.stroke()
      }

      t += 0.003
      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas ref={canvasRef} style={{
      position: 'fixed', top: 0, left: 0,
      width: '100%', height: '100%',
      zIndex: 0, pointerEvents: 'none',
    }} />
  )
}
