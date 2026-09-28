export default function HealthPage() {
  return (
    <div className="min-h-screen bg-[#111111] flex items-center justify-center p-8">
      <div className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-2xl p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold text-[#f5f5f5] mb-2">Critiq is online</h1>
        <p className="text-[#a0a0a0] text-sm mb-6">The application is responding normally.</p>
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-[#a0a0a0] text-sm">Application</span>
            <span className="text-green-400 text-sm font-medium">Operational</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#a0a0a0] text-sm">Status</span>
            <span className="text-[#f5f5f5] text-sm">200 OK</span>
          </div>
        </div>
      </div>
    </div>
  )
}
