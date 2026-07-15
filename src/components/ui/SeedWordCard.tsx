export function SeedWordCard({ index, word }: { index: number; word: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/7 px-3 py-2.5">
      <span className="w-6 text-right text-xs text-slate-500">{index}</span>
      <span className="font-medium text-slate-100">{word}</span>
    </div>
  )
}
