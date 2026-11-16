"use client"
import {
  Kanban,
  type KanbanBoard,
  KanbanColumn,
  KanbanColumnHeader,
  KanbanColumnTitle,
  KanbanItem,
  KanbanList,
  type KanbanMove,
} from "@dapplelight/signet-ui/domain/kanban"
import { useState } from "react"

const tasks: Record<string, string> = {
  t1: "Draft Q3 pricing page",
  t2: "Fix invoice rounding bug",
  t3: "Onboard Northwind account",
  t4: "Migrate webhooks to v2",
  t5: "Ship dark mode",
}
const columns = { todo: "To do", doing: "In progress", done: "Done" }

export function KanbanDemo() {
  return (
    <Kanban
      aria-label="Sprint board"
      defaultValue={{ todo: ["t1", "t2", "t3"], doing: ["t4"], done: ["t5"] }}
    >
      {(board) =>
        Object.entries(columns).map(([value, title]) => (
          <KanbanColumn key={value} value={value}>
            <KanbanColumnHeader>
              <KanbanColumnTitle>{title}</KanbanColumnTitle>
              <span className="text-xs text-neutral-500">{board[value]?.length ?? 0}</span>
            </KanbanColumnHeader>
            <KanbanList>
              {(board[value] ?? []).map((id) => (
                <KanbanItem key={id} value={id}>
                  {tasks[id]}
                </KanbanItem>
              ))}
            </KanbanList>
          </KanbanColumn>
        ))
      }
    </Kanban>
  )
}

export function KanbanControlledDemo() {
  const [board, setBoard] = useState<KanbanBoard>({
    todo: ["t1", "t2", "t3"],
    doing: ["t4"],
    done: ["t5"],
  })
  const [last, setLast] = useState<KanbanMove | null>(null)
  return (
    <div className="flex w-full flex-col gap-3">
      <Kanban aria-label="Sprint board" value={board} onValueChange={setBoard} onItemMove={setLast}>
        {Object.entries(columns).map(([value, title]) => (
          <KanbanColumn key={value} value={value}>
            <KanbanColumnHeader>
              <KanbanColumnTitle>{title}</KanbanColumnTitle>
            </KanbanColumnHeader>
            <KanbanList>
              {(board[value] ?? []).map((id) => (
                <KanbanItem key={id} value={id}>
                  {tasks[id]}
                </KanbanItem>
              ))}
            </KanbanList>
          </KanbanColumn>
        ))}
      </Kanban>
      <p className="text-xs text-neutral-500">
        {last
          ? `Moved ${tasks[last.item]} from ${last.from} to ${last.to} at ${last.index}`
          : "Drag a card, or focus one and press Space."}
      </p>
    </div>
  )
}

export function KanbanMessagesDemo() {
  return (
    <Kanban
      aria-label="Sprint board"
      defaultValue={{ todo: ["t1", "t2"], done: ["t5"] }}
      messages={{
        instructions: "Space picks up a card. Arrows move it. Space drops it.",
        dropped: (item, column, p, n) => `${item} now in ${column}, ${p} of ${n}.`,
      }}
    >
      {(board) => (
        <>
          <KanbanColumn value="todo" label="To do">
            <KanbanList>
              {(board.todo ?? []).map((id) => (
                <KanbanItem key={id} value={id}>
                  {tasks[id]}
                </KanbanItem>
              ))}
            </KanbanList>
          </KanbanColumn>
          <KanbanColumn value="done" label="Done">
            <KanbanList>
              {(board.done ?? []).map((id) => (
                <KanbanItem key={id} value={id}>
                  {tasks[id]}
                </KanbanItem>
              ))}
            </KanbanList>
          </KanbanColumn>
        </>
      )}
    </Kanban>
  )
}
