"use client"

import { Suspense } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

// The pages are grouped into sections: the header links to the sections, and a row of tabs
// under it links to the pages of the current one. URLs stay those of the pages.
const SECTIONS = [
  {
    label: "Create",
    pages: [
      { href: "/", label: "Generate" },
      { href: "/anonymize", label: "Anonymize" },
      { href: "/record", label: "Record" },
      { href: "/transcribe", label: "Transcribe" },
      { href: "/conversation", label: "Conversation" },
    ],
  },
  {
    label: "Library",
    pages: [
      { href: "/saved", label: "Saved" },
      { href: "/dataset", label: "Datasets" },
      { href: "/speakers", label: "Speakers" },
    ],
  },
] as const

type Page = (typeof SECTIONS)[number]["pages"][number]

// sub-pages such as a sample's annotation belong to their page
function isActive(href: string, pathname: string | null): boolean {
  return !!pathname && (pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)))
}

function currentSection(pathname: string | null) {
  return SECTIONS.find((s) => s.pages.some((p) => isActive(p.href, pathname))) ?? null
}

// The pathname of pages with an id (/saved/[id]) is only known at request time, so the
// prerendered layout shows the links without the current one highlighted until it is.
export function NavLinks() {
  return (
    <Suspense fallback={<Sections pathname={null} />}>
      <CurrentSections />
    </Suspense>
  )
}

function CurrentSections() {
  return <Sections pathname={usePathname()} />
}

function Sections({ pathname }: { pathname: string | null }) {
  const current = currentSection(pathname)
  return (
    <nav className="flex items-center gap-3 text-sm sm:gap-4">
      {SECTIONS.map((section) => (
        <Link
          key={section.label}
          href={section.pages[0].href}
          aria-current={section === current ? "true" : undefined}
          className={cn("text-muted-foreground hover:text-foreground", section === current && "font-medium text-foreground")}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  )
}

/** The pages of the current section as tabs under the header; nothing on pages outside them. */
export function SectionTabs() {
  return (
    <Suspense fallback={null}>
      <CurrentTabs />
    </Suspense>
  )
}

function CurrentTabs() {
  const pathname = usePathname()
  const section = currentSection(pathname)
  if (!section) return null
  return (
    <div className="border-b">
      <nav aria-label={section.label} className="mx-auto flex max-w-6xl gap-5 px-4 text-sm">
        {section.pages.map((page: Page) => {
          const active = isActive(page.href, pathname)
          return (
            <Link
              key={page.href}
              href={page.href}
              aria-current={active ? "page" : undefined}
              // the active tab's underline is an inset shadow, so it stays inside the row: a border
              // pulled over the row's own border makes the row overflow
              className={cn(
                "py-2.5 whitespace-nowrap text-muted-foreground hover:text-foreground",
                active && "font-medium text-foreground shadow-[inset_0_-2px_0_currentColor]",
              )}
            >
              {page.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
