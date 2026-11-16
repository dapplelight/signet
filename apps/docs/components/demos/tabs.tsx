"use client"

import { Button } from "@dapplelight/signet-ui/components/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@dapplelight/signet-ui/components/tabs"
import { useState } from "react"

export function TabsDemo() {
  return (
    <Tabs defaultValue="overview" className="w-full max-w-md">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="orders">Orders</TabsTrigger>
        <TabsTrigger value="billing">Billing</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">Revenue is up 12% this month.</TabsContent>
      <TabsContent value="orders">1,284 orders, 38 awaiting shipment.</TabsContent>
      <TabsContent value="billing">Next invoice on the 1st.</TabsContent>
    </Tabs>
  )
}

export function TabsLineDemo() {
  return (
    <Tabs defaultValue="overview" className="w-full max-w-md">
      <TabsList variant="line">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="orders">Orders</TabsTrigger>
        <TabsTrigger value="billing">Billing</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">Revenue is up 12% this month.</TabsContent>
      <TabsContent value="orders">1,284 orders, 38 awaiting shipment.</TabsContent>
      <TabsContent value="billing">Next invoice on the 1st.</TabsContent>
    </Tabs>
  )
}

export function TabsVerticalDemo() {
  return (
    <Tabs defaultValue="overview" className="w-full max-w-md flex-row" orientation="vertical">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="orders">Orders</TabsTrigger>
        <TabsTrigger value="billing">Billing</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">Revenue is up 12% this month.</TabsContent>
      <TabsContent value="orders">1,284 orders, 38 awaiting shipment.</TabsContent>
      <TabsContent value="billing">Next invoice on the 1st.</TabsContent>
    </Tabs>
  )
}

export function TabsDisabledDemo() {
  return (
    <Tabs defaultValue="overview" className="w-full max-w-md">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="orders">Orders</TabsTrigger>
        <TabsTrigger value="billing" disabled>
          Billing
        </TabsTrigger>
      </TabsList>
      <TabsContent value="overview">Revenue is up 12% this month.</TabsContent>
      <TabsContent value="orders">1,284 orders, 38 awaiting shipment.</TabsContent>
      <TabsContent value="billing">Next invoice on the 1st.</TabsContent>
    </Tabs>
  )
}

export function TabsControlledDemo() {
  const [tab, setTab] = useState("overview")
  return (
    <div className="w-full max-w-md space-y-3">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Revenue is up 12% this month.</TabsContent>
        <TabsContent value="orders">1,284 orders, 38 awaiting shipment.</TabsContent>
      </Tabs>
      <Button variant="outline" size="sm" onClick={() => setTab("orders")}>
        Jump to Orders
      </Button>
    </div>
  )
}
