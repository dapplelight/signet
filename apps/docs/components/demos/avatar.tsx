"use client"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  initials,
} from "@dapplelight/signet-ui/components/avatar"

const team = ["Priya Nair", "Marcus Chen", "Sofia Alvarez"]

export function AvatarDemo() {
  return (
    <Avatar>
      <AvatarImage src="data:," alt="Priya Nair" />
      <AvatarFallback>PN</AvatarFallback>
    </Avatar>
  )
}

export function AvatarSizesDemo() {
  return (
    <>
      <Avatar size="sm">
        <AvatarFallback>PN</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>PN</AvatarFallback>
      </Avatar>
      <Avatar size="lg">
        <AvatarFallback>PN</AvatarFallback>
      </Avatar>
    </>
  )
}

export function AvatarInitialsDemo() {
  return (
    <>
      {team.map((name) => (
        <Avatar key={name}>
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
      ))}
    </>
  )
}

export function AvatarGroupDemo() {
  return (
    <div className="flex -space-x-2">
      {team.map((name) => (
        <Avatar key={name} className="ring-2 ring-bg-surface">
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
      ))}
    </div>
  )
}
