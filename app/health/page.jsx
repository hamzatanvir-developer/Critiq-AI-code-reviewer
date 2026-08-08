async function getData() {
  const res = await fetch('https://api.github.com/users/hamzatanvir-developer')
  return res.json()
}

export default async function HealthPage() {
  const data = await getData()
  return (
    <div className="min-h-screen bg-[#0d0d0f] flex items-center justify-center p-8">
      <div className="bg-[#1a1a2e] border border-purple-900/30 rounded-2xl p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold text-white mb-2">Health Check ✓</h1>
        <p className="text-green-400 text-sm mb-6">All systems operational</p>
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-zinc-500 text-sm">GitHub API</span>
            <span className="text-green-400 text-sm font-medium">Connected</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500 text-sm">User</span>
            <span className="text-white text-sm">{data.login}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500 text-sm">Public Repos</span>
            <span className="text-white text-sm">{data.public_repos}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500 text-sm">Followers</span>
            <span className="text-white text-sm">{data.followers}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
