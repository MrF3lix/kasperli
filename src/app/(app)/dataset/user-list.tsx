import type { UserRef } from "@/lib/datasets"

/** Users as a comma-separated list of names (emails on hover), with the current user as "you". */
export function UserList({ users, currentUserId, empty = "Nobody else" }: { users: UserRef[]; currentUserId: string; empty?: string }) {
  if (!users.length) {
    return <span className="text-muted-foreground">{empty}</span>
  }
  return (
    <span>
      {users.map((u, i) => (
        <span key={u.id}>
          {i > 0 && ", "}
          <span title={u.email || undefined}>{u.id === currentUserId ? "you" : u.name}</span>
        </span>
      ))}
    </span>
  )
}
