async function getData() {
  const res = await fetch('https://api.github.com/users/hamzatanvir-developer')
  return res.json()
}

export default async function HealthPage() {
  const data = await getData()
  return (
    <div className="min-h-screen bg-[#111111] flex items-center justify-center p-8">
      <div className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-2xl p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold text-[#f5f5f5] mb-2">Health Check ✓</h1>
        <p className="text-[#a0a0a0] text-sm mb-6">All systems operational</p>
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-[#a0a0a0] text-sm">GitHub API</span>
            <span className="text-[#e0e0e0] text-sm font-medium">Connected</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#a0a0a0] text-sm">User</span>
            <span className="text-[#f5f5f5] text-sm">{data.login}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#a0a0a0] text-sm">Public Repos</span>
            <span className="text-[#f5f5f5] text-sm">{data.public_repos}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#a0a0a0] text-sm">Followers</span>
            <span className="text-[#f5f5f5] text-sm">{data.followers}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
