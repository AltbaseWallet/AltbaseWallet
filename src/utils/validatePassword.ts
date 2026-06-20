import { z } from 'zod'

export const passwordSchema = z
  .string()
  .min(8, 'passwordMinHint')
  .regex(/[0-9]/, 'passwordMinHint')
  .regex(/\p{L}/u, 'passwordMinHint')

export const passwordPairSchema = z
  .object({
    password: passwordSchema,
    repeatPassword: z.string(),
  })
  .refine((data) => data.password === data.repeatPassword, {
    message: 'passwordsMustMatch',
    path: ['repeatPassword'],
  })

export const passwordValidationKeys = new Set(['passwordMinHint', 'passwordsMustMatch'])

export const getPasswordStrength = (password: string) => {
  let score = 0
  if (password.length >= 8) score += 1
  if (/\p{Lu}/u.test(password)) score += 1
  if (/[0-9]/.test(password)) score += 1
  if (/[^\p{L}0-9]/u.test(password)) score += 1
  return Math.min(score, 4)
}
