import { createFileRoute } from '@tanstack/react-router'
import { greet } from '../server-fns'

export const Route = createFileRoute('/')({
  loader: () => greet(),
  component: Home,
})

function Home() {
  const data = Route.useLoaderData()
  return (
    <div className="flex-1 p-4 bg-ps-bg">
      <div className="px-6 rounded-full focus:ring-2 active:scale-95 hover:bg-white">
        {data.message}
      </div>
    </div>
  )
}
