"use client"
import { Button } from "@dapplelight/signet-ui/components/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@dapplelight/signet-ui/components/drawer"

export function DrawerDemo() {
  return (
    <Drawer showSwipeHandle>
      <DrawerTrigger render={<Button variant="outline" />}>Open order</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Order #8841</DrawerTitle>
          <DrawerDescription>3 items, $214.00, shipping to Pune.</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button>Mark as shipped</Button>
          <DrawerClose render={<Button variant="outline" />}>Close</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export function DrawerSideDemo() {
  return (
    <Drawer swipeDirection="right">
      <DrawerTrigger render={<Button variant="outline" />}>Filters</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Filter orders</DrawerTitle>
          <DrawerDescription>Narrow the list by status and date.</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button>Apply filters</Button>
          <DrawerClose render={<Button variant="outline" />}>Cancel</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export function DrawerSnapDemo() {
  return (
    <Drawer snapPoints={[0.4, 1]} showSwipeHandle>
      <DrawerTrigger render={<Button variant="outline" />}>Customer details</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Northwind Traders</DrawerTitle>
          <DrawerDescription>Drag up for the full history.</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <DrawerClose render={<Button variant="outline" />}>Done</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
