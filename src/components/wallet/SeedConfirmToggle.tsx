import { Check } from 'lucide-react'
import { useT } from '../../utils/i18n'

type SeedConfirmToggleProps = {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
  onChecked?: () => void
  disabled?: boolean
}

export function SeedConfirmToggle({ checked, label, onChange, onChecked, disabled = false }: SeedConfirmToggleProps) {
  const update = (nextChecked: boolean) => {
    if (disabled) return
    onChange(nextChecked)
    if (nextChecked) onChecked?.()
  }

  return (
    <label
      className={[
        'group flex items-center gap-3 rounded-lg border p-4 text-sm transition',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        checked
          ? 'border-emerald-400/60 bg-emerald-400/10 text-white shadow-[0_0_0_1px_rgba(52,211,153,0.16)]'
          : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:bg-white/[0.06]',
      ].join(' ')}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => update(event.target.checked)}
      />
      <span
        className={[
          'grid h-6 w-6 shrink-0 place-items-center rounded-md border transition',
          checked
            ? 'border-emerald-300 bg-emerald-400 text-ink'
            : 'border-slate-500 bg-slate-950/60 group-hover:border-slate-300',
        ].join(' ')}
        aria-hidden="true"
      >
        {checked && <Check size={16} strokeWidth={3} />}
      </span>
      <span className="leading-5">{label}</span>
    </label>
  )
}

type SeedNoShareConfirmProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  onChecked?: () => void
  disabled?: boolean
}

export function SeedNoShareConfirm({ checked, onChange, onChecked, disabled }: SeedNoShareConfirmProps) {
  const t = useT()

  return (
    <SeedConfirmToggle
      checked={checked}
      onChange={onChange}
      onChecked={onChecked}
      disabled={disabled}
      label={t('understandNoShare')}
    />
  )
}
