import { useEffect, useState } from 'react'

// The character set of base64url, so the scrambled text looks exactly like the
// ciphertext it is pretending to unwrap.
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/**
 * Reveals text left-to-right while the not-yet-revealed characters keep
 * shuffling -- the visual shorthand for "this was encrypted a moment ago".
 */
export default function DecryptText({ text = '', delay = 0, tick = 26, className }) {
  const [display, setDisplay] = useState('')

  useEffect(() => {
    if (!text) {
      setDisplay('')
      return
    }

    // Some people get motion sick from animation. Honour their system setting.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(text)
      return
    }

    const characters = [...text]
    let revealed = 0
    let interval

    const timeout = setTimeout(() => {
      interval = setInterval(() => {
        revealed += 0.5 // half a character per tick, so it lands on the beat
        setDisplay(
          characters
            .map((char, i) =>
              i < Math.floor(revealed) || char === ' '
                ? char
                : CHARSET[Math.floor(Math.random() * CHARSET.length)],
            )
            .join(''),
        )
        if (revealed >= characters.length) clearInterval(interval)
      }, tick)
    }, delay)

    return () => {
      clearTimeout(timeout)
      clearInterval(interval)
    }
  }, [text, delay, tick])

  // Screen readers get the real text; the shuffling is decoration.
  return (
    <span className={className} aria-label={text}>
      <span aria-hidden="true">{display || ' '}</span>
    </span>
  )
}
