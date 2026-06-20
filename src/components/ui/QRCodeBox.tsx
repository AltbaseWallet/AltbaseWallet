import { QRCodeSVG } from 'qrcode.react'

export function QRCodeBox({ value }: { value: string }) {
  if (!value) {
    return (
      <div className="mx-auto grid h-48 w-48 place-items-center rounded-[22px] border border-dashed border-white/15 bg-white/7 p-4 text-center text-sm text-slate-400">
        Address is not ready
      </div>
    )
  }

  return (
    <div className="mx-auto grid h-48 w-48 place-items-center rounded-[22px] border border-white/10 bg-white p-3">
      <QRCodeSVG value={value} size={160} bgColor="#ffffff" fgColor="#0B0F17" />
    </div>
  )
}
