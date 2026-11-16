"use client"
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@dapplelight/signet-ui/components/combobox"
import * as React from "react"

const customers = [
  "Acme Corp",
  "Globex",
  "Initech",
  "Umbrella Ltd",
  "Wayne Enterprises",
  "Stark Industries",
]

export function ComboboxDemo() {
  return (
    <Combobox items={customers}>
      <ComboboxInput placeholder="Select a customer" className="w-64" />
      <ComboboxContent>
        <ComboboxEmpty>No customers found.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

export function ComboboxClearDemo() {
  return (
    <Combobox items={customers} defaultValue="Globex">
      <ComboboxInput placeholder="Select a customer" showClear className="w-64" />
      <ComboboxContent>
        <ComboboxEmpty>No customers found.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

export function ComboboxMultipleDemo() {
  const anchor = useComboboxAnchor()
  return (
    <Combobox multiple items={customers} defaultValue={["Acme Corp", "Initech"]}>
      <ComboboxChips ref={anchor} className="w-80">
        <ComboboxValue>
          {(values: string[]) => (
            <>
              {values.map((value) => (
                <ComboboxChip key={value}>{value}</ComboboxChip>
              ))}
              <ComboboxChipsInput placeholder="Add customer" />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>No customers found.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

export function ComboboxControlledDemo() {
  const [value, setValue] = React.useState<string | null>("Umbrella Ltd")
  return (
    <div className="flex flex-col gap-2">
      <Combobox items={customers} value={value} onValueChange={setValue}>
        <ComboboxInput placeholder="Select a customer" className="w-64" />
        <ComboboxContent>
          <ComboboxEmpty>No customers found.</ComboboxEmpty>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <p className="text-xs text-text-muted">Billing: {value ?? "nobody"}</p>
    </div>
  )
}
