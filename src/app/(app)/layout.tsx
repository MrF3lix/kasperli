import { Suspense } from "react"
import Link from "next/link"
import { NavLinks, SectionTabs } from "./nav-links"
import { StatusDot } from "./status-dot"
import { UserMenu } from "./user-menu"

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-4 sm:gap-6">
            <Link href="/" className="font-semibold">Kasperli</Link>
            <NavLinks />
          </div>
          <div className="flex items-center gap-4">
            {/* knows the current page only at request time, like the section links */}
            <Suspense fallback={<span className="size-2.5 rounded-full bg-muted-foreground/40" aria-hidden />}>
              <StatusDot />
            </Suspense>
            {/* reads the session, so it streams in after the static shell */}
            <Suspense fallback={<div className="h-8 w-40" />}>
              <UserMenu />
            </Suspense>
          </div>
        </div>
      </header>
      <SectionTabs />
      <main className="mx-auto w-full max-w-6xl flex-1 p-4">{children}</main>
    </>
  )
}
