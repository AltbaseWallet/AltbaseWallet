import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { Input } from './Input'
import { Button } from './Button'
import { useT } from '../../utils/i18n'

type PasswordInputProps = Omit<Parameters<typeof Input>[0], 'type'>

export function PasswordInput({ error, className, ...props }: PasswordInputProps) {
  const t = useT()
  const [visible, setVisible] = useState(false)

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input {...props} type={visible ? 'text' : 'password'} error={error} hideErrorText className={`pr-12 ${className ?? ''}`} />
        <Button
          type="button"
          aria-label={visible ? t('ariaHidePassword') : t('ariaShowPassword')}
          variant="ghost"
          size="sm"
          className="absolute bottom-1.5 right-1.5 h-9 w-9 rounded-xl p-0"
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </Button>
      </div>
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </div>
  )
}
