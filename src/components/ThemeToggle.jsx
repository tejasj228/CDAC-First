export default function ThemeToggle({ theme, onChange }) {
  const isLight = theme === 'light'

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => onChange(isLight ? 'dark' : 'light')}
      title="Saved in the encrypted preferences cookie"
      aria-label={`Switch to ${isLight ? 'dark' : 'light'} mode`}
    >
      <span className={isLight ? 'knob light' : 'knob'} aria-hidden="true" />
      <span className="eyebrow">{isLight ? 'light' : 'dark'}</span>
    </button>
  )
}
