// Generated: 120 tools with distinct schemas, so tsc checks 120 separate
// defineTool instantiations — the scale at which app-a's tsc ran out of memory.
// Each handler assigns its fields to their expected types; a wrong inference fails typecheck.
import { z } from "zod"
import { defineTool, type McpTool } from "../../src/mcp"

export const MANY_TOOLS: McpTool[] = [
  defineTool({
    name: "tool_0",
    description: "Generated tool 0",
    input: z.object({
      f0_0: z.string().min(1),
      f3_0: z.string().optional(),
      f6_0: z.boolean().default(false),
    }),
    handler: (input) => {
      const v0: string = input.f0_0
      void v0
      const v3: string | undefined = input.f3_0
      void v3
      const v6: boolean = input.f6_0
      void v6
      return { tool: 0, input }
    },
  }),
  defineTool({
    name: "tool_1",
    description: "Generated tool 1",
    input: z.object({
      f1_1: z.number().int().default(5),
      f4_1: z.array(z.string()).max(10),
      f7_1: z.string().transform((s) => s.length),
    }),
    handler: (input) => {
      const v1: number = input.f1_1
      void v1
      const v4: string[] = input.f4_1
      void v4
      const v7: number = input.f7_1
      void v7
      return { tool: 1, input }
    },
  }),
  defineTool({
    name: "tool_2",
    description: "Generated tool 2",
    input: z.object({
      f2_2: z.enum(["a", "b", "c"]),
      f5_2: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_2: z.string().min(1),
    }),
    handler: (input) => {
      const v2: "a" | "b" | "c" = input.f2_2
      void v2
      const v5: { x: number; y: string | null } = input.f5_2
      void v5
      const v0: string = input.f0_2
      void v0
      return { tool: 2, input }
    },
  }),
  defineTool({
    name: "tool_3",
    description: "Generated tool 3",
    input: z.object({
      f3_3: z.string().optional(),
      f6_3: z.boolean().default(false),
      f1_3: z.number().int().default(5),
    }),
    handler: (input) => {
      const v3: string | undefined = input.f3_3
      void v3
      const v6: boolean = input.f6_3
      void v6
      const v1: number = input.f1_3
      void v1
      return { tool: 3, input }
    },
  }),
  defineTool({
    name: "tool_4",
    description: "Generated tool 4",
    input: z.object({
      f4_4: z.array(z.string()).max(10),
      f7_4: z.string().transform((s) => s.length),
      f2_4: z.enum(["a", "b", "c"]),
    }),
    handler: (input) => {
      const v4: string[] = input.f4_4
      void v4
      const v7: number = input.f7_4
      void v7
      const v2: "a" | "b" | "c" = input.f2_4
      void v2
      return { tool: 4, input }
    },
  }),
  defineTool({
    name: "tool_5",
    description: "Generated tool 5",
    input: z.object({
      f5_5: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_5: z.string().min(1),
      f3_5: z.string().optional(),
    }),
    handler: (input) => {
      const v5: { x: number; y: string | null } = input.f5_5
      void v5
      const v0: string = input.f0_5
      void v0
      const v3: string | undefined = input.f3_5
      void v3
      return { tool: 5, input }
    },
  }),
  defineTool({
    name: "tool_6",
    description: "Generated tool 6",
    input: z.object({
      f6_6: z.boolean().default(false),
      f1_6: z.number().int().default(5),
      f4_6: z.array(z.string()).max(10),
    }),
    handler: (input) => {
      const v6: boolean = input.f6_6
      void v6
      const v1: number = input.f1_6
      void v1
      const v4: string[] = input.f4_6
      void v4
      return { tool: 6, input }
    },
  }),
  defineTool({
    name: "tool_7",
    description: "Generated tool 7",
    input: z.object({
      f7_7: z.string().transform((s) => s.length),
      f2_7: z.enum(["a", "b", "c"]),
      f5_7: z.object({ x: z.number(), y: z.string().nullable() }),
    }),
    handler: (input) => {
      const v7: number = input.f7_7
      void v7
      const v2: "a" | "b" | "c" = input.f2_7
      void v2
      const v5: { x: number; y: string | null } = input.f5_7
      void v5
      return { tool: 7, input }
    },
  }),
  defineTool({
    name: "tool_8",
    description: "Generated tool 8",
    input: z.object({
      f0_8: z.string().min(1),
      f3_8: z.string().optional(),
      f6_8: z.boolean().default(false),
    }),
    handler: (input) => {
      const v0: string = input.f0_8
      void v0
      const v3: string | undefined = input.f3_8
      void v3
      const v6: boolean = input.f6_8
      void v6
      return { tool: 8, input }
    },
  }),
  defineTool({
    name: "tool_9",
    description: "Generated tool 9",
    input: z.object({
      f1_9: z.number().int().default(5),
      f4_9: z.array(z.string()).max(10),
      f7_9: z.string().transform((s) => s.length),
    }),
    handler: (input) => {
      const v1: number = input.f1_9
      void v1
      const v4: string[] = input.f4_9
      void v4
      const v7: number = input.f7_9
      void v7
      return { tool: 9, input }
    },
  }),
  defineTool({
    name: "tool_10",
    description: "Generated tool 10",
    input: z.object({
      f2_10: z.enum(["a", "b", "c"]),
      f5_10: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_10: z.string().min(1),
    }),
    handler: (input) => {
      const v2: "a" | "b" | "c" = input.f2_10
      void v2
      const v5: { x: number; y: string | null } = input.f5_10
      void v5
      const v0: string = input.f0_10
      void v0
      return { tool: 10, input }
    },
  }),
  defineTool({
    name: "tool_11",
    description: "Generated tool 11",
    input: z.object({
      f3_11: z.string().optional(),
      f6_11: z.boolean().default(false),
      f1_11: z.number().int().default(5),
    }),
    handler: (input) => {
      const v3: string | undefined = input.f3_11
      void v3
      const v6: boolean = input.f6_11
      void v6
      const v1: number = input.f1_11
      void v1
      return { tool: 11, input }
    },
  }),
  defineTool({
    name: "tool_12",
    description: "Generated tool 12",
    input: z.object({
      f4_12: z.array(z.string()).max(10),
      f7_12: z.string().transform((s) => s.length),
      f2_12: z.enum(["a", "b", "c"]),
    }),
    handler: (input) => {
      const v4: string[] = input.f4_12
      void v4
      const v7: number = input.f7_12
      void v7
      const v2: "a" | "b" | "c" = input.f2_12
      void v2
      return { tool: 12, input }
    },
  }),
  defineTool({
    name: "tool_13",
    description: "Generated tool 13",
    input: z.object({
      f5_13: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_13: z.string().min(1),
      f3_13: z.string().optional(),
    }),
    handler: (input) => {
      const v5: { x: number; y: string | null } = input.f5_13
      void v5
      const v0: string = input.f0_13
      void v0
      const v3: string | undefined = input.f3_13
      void v3
      return { tool: 13, input }
    },
  }),
  defineTool({
    name: "tool_14",
    description: "Generated tool 14",
    input: z.object({
      f6_14: z.boolean().default(false),
      f1_14: z.number().int().default(5),
      f4_14: z.array(z.string()).max(10),
    }),
    handler: (input) => {
      const v6: boolean = input.f6_14
      void v6
      const v1: number = input.f1_14
      void v1
      const v4: string[] = input.f4_14
      void v4
      return { tool: 14, input }
    },
  }),
  defineTool({
    name: "tool_15",
    description: "Generated tool 15",
    input: z.object({
      f7_15: z.string().transform((s) => s.length),
      f2_15: z.enum(["a", "b", "c"]),
      f5_15: z.object({ x: z.number(), y: z.string().nullable() }),
    }),
    handler: (input) => {
      const v7: number = input.f7_15
      void v7
      const v2: "a" | "b" | "c" = input.f2_15
      void v2
      const v5: { x: number; y: string | null } = input.f5_15
      void v5
      return { tool: 15, input }
    },
  }),
  defineTool({
    name: "tool_16",
    description: "Generated tool 16",
    input: z.object({
      f0_16: z.string().min(1),
      f3_16: z.string().optional(),
      f6_16: z.boolean().default(false),
    }),
    handler: (input) => {
      const v0: string = input.f0_16
      void v0
      const v3: string | undefined = input.f3_16
      void v3
      const v6: boolean = input.f6_16
      void v6
      return { tool: 16, input }
    },
  }),
  defineTool({
    name: "tool_17",
    description: "Generated tool 17",
    input: z.object({
      f1_17: z.number().int().default(5),
      f4_17: z.array(z.string()).max(10),
      f7_17: z.string().transform((s) => s.length),
    }),
    handler: (input) => {
      const v1: number = input.f1_17
      void v1
      const v4: string[] = input.f4_17
      void v4
      const v7: number = input.f7_17
      void v7
      return { tool: 17, input }
    },
  }),
  defineTool({
    name: "tool_18",
    description: "Generated tool 18",
    input: z.object({
      f2_18: z.enum(["a", "b", "c"]),
      f5_18: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_18: z.string().min(1),
    }),
    handler: (input) => {
      const v2: "a" | "b" | "c" = input.f2_18
      void v2
      const v5: { x: number; y: string | null } = input.f5_18
      void v5
      const v0: string = input.f0_18
      void v0
      return { tool: 18, input }
    },
  }),
  defineTool({
    name: "tool_19",
    description: "Generated tool 19",
    input: z.object({
      f3_19: z.string().optional(),
      f6_19: z.boolean().default(false),
      f1_19: z.number().int().default(5),
    }),
    handler: (input) => {
      const v3: string | undefined = input.f3_19
      void v3
      const v6: boolean = input.f6_19
      void v6
      const v1: number = input.f1_19
      void v1
      return { tool: 19, input }
    },
  }),
  defineTool({
    name: "tool_20",
    description: "Generated tool 20",
    input: z.object({
      f4_20: z.array(z.string()).max(10),
      f7_20: z.string().transform((s) => s.length),
      f2_20: z.enum(["a", "b", "c"]),
    }),
    handler: (input) => {
      const v4: string[] = input.f4_20
      void v4
      const v7: number = input.f7_20
      void v7
      const v2: "a" | "b" | "c" = input.f2_20
      void v2
      return { tool: 20, input }
    },
  }),
  defineTool({
    name: "tool_21",
    description: "Generated tool 21",
    input: z.object({
      f5_21: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_21: z.string().min(1),
      f3_21: z.string().optional(),
    }),
    handler: (input) => {
      const v5: { x: number; y: string | null } = input.f5_21
      void v5
      const v0: string = input.f0_21
      void v0
      const v3: string | undefined = input.f3_21
      void v3
      return { tool: 21, input }
    },
  }),
  defineTool({
    name: "tool_22",
    description: "Generated tool 22",
    input: z.object({
      f6_22: z.boolean().default(false),
      f1_22: z.number().int().default(5),
      f4_22: z.array(z.string()).max(10),
    }),
    handler: (input) => {
      const v6: boolean = input.f6_22
      void v6
      const v1: number = input.f1_22
      void v1
      const v4: string[] = input.f4_22
      void v4
      return { tool: 22, input }
    },
  }),
  defineTool({
    name: "tool_23",
    description: "Generated tool 23",
    input: z.object({
      f7_23: z.string().transform((s) => s.length),
      f2_23: z.enum(["a", "b", "c"]),
      f5_23: z.object({ x: z.number(), y: z.string().nullable() }),
    }),
    handler: (input) => {
      const v7: number = input.f7_23
      void v7
      const v2: "a" | "b" | "c" = input.f2_23
      void v2
      const v5: { x: number; y: string | null } = input.f5_23
      void v5
      return { tool: 23, input }
    },
  }),
  defineTool({
    name: "tool_24",
    description: "Generated tool 24",
    input: z.object({
      f0_24: z.string().min(1),
      f3_24: z.string().optional(),
      f6_24: z.boolean().default(false),
    }),
    handler: (input) => {
      const v0: string = input.f0_24
      void v0
      const v3: string | undefined = input.f3_24
      void v3
      const v6: boolean = input.f6_24
      void v6
      return { tool: 24, input }
    },
  }),
  defineTool({
    name: "tool_25",
    description: "Generated tool 25",
    input: z.object({
      f1_25: z.number().int().default(5),
      f4_25: z.array(z.string()).max(10),
      f7_25: z.string().transform((s) => s.length),
    }),
    handler: (input) => {
      const v1: number = input.f1_25
      void v1
      const v4: string[] = input.f4_25
      void v4
      const v7: number = input.f7_25
      void v7
      return { tool: 25, input }
    },
  }),
  defineTool({
    name: "tool_26",
    description: "Generated tool 26",
    input: z.object({
      f2_26: z.enum(["a", "b", "c"]),
      f5_26: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_26: z.string().min(1),
    }),
    handler: (input) => {
      const v2: "a" | "b" | "c" = input.f2_26
      void v2
      const v5: { x: number; y: string | null } = input.f5_26
      void v5
      const v0: string = input.f0_26
      void v0
      return { tool: 26, input }
    },
  }),
  defineTool({
    name: "tool_27",
    description: "Generated tool 27",
    input: z.object({
      f3_27: z.string().optional(),
      f6_27: z.boolean().default(false),
      f1_27: z.number().int().default(5),
    }),
    handler: (input) => {
      const v3: string | undefined = input.f3_27
      void v3
      const v6: boolean = input.f6_27
      void v6
      const v1: number = input.f1_27
      void v1
      return { tool: 27, input }
    },
  }),
  defineTool({
    name: "tool_28",
    description: "Generated tool 28",
    input: z.object({
      f4_28: z.array(z.string()).max(10),
      f7_28: z.string().transform((s) => s.length),
      f2_28: z.enum(["a", "b", "c"]),
    }),
    handler: (input) => {
      const v4: string[] = input.f4_28
      void v4
      const v7: number = input.f7_28
      void v7
      const v2: "a" | "b" | "c" = input.f2_28
      void v2
      return { tool: 28, input }
    },
  }),
  defineTool({
    name: "tool_29",
    description: "Generated tool 29",
    input: z.object({
      f5_29: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_29: z.string().min(1),
      f3_29: z.string().optional(),
    }),
    handler: (input) => {
      const v5: { x: number; y: string | null } = input.f5_29
      void v5
      const v0: string = input.f0_29
      void v0
      const v3: string | undefined = input.f3_29
      void v3
      return { tool: 29, input }
    },
  }),
  defineTool({
    name: "tool_30",
    description: "Generated tool 30",
    input: z.object({
      f6_30: z.boolean().default(false),
      f1_30: z.number().int().default(5),
      f4_30: z.array(z.string()).max(10),
    }),
    handler: (input) => {
      const v6: boolean = input.f6_30
      void v6
      const v1: number = input.f1_30
      void v1
      const v4: string[] = input.f4_30
      void v4
      return { tool: 30, input }
    },
  }),
  defineTool({
    name: "tool_31",
    description: "Generated tool 31",
    input: z.object({
      f7_31: z.string().transform((s) => s.length),
      f2_31: z.enum(["a", "b", "c"]),
      f5_31: z.object({ x: z.number(), y: z.string().nullable() }),
    }),
    handler: (input) => {
      const v7: number = input.f7_31
      void v7
      const v2: "a" | "b" | "c" = input.f2_31
      void v2
      const v5: { x: number; y: string | null } = input.f5_31
      void v5
      return { tool: 31, input }
    },
  }),
  defineTool({
    name: "tool_32",
    description: "Generated tool 32",
    input: z.object({
      f0_32: z.string().min(1),
      f3_32: z.string().optional(),
      f6_32: z.boolean().default(false),
    }),
    handler: (input) => {
      const v0: string = input.f0_32
      void v0
      const v3: string | undefined = input.f3_32
      void v3
      const v6: boolean = input.f6_32
      void v6
      return { tool: 32, input }
    },
  }),
  defineTool({
    name: "tool_33",
    description: "Generated tool 33",
    input: z.object({
      f1_33: z.number().int().default(5),
      f4_33: z.array(z.string()).max(10),
      f7_33: z.string().transform((s) => s.length),
    }),
    handler: (input) => {
      const v1: number = input.f1_33
      void v1
      const v4: string[] = input.f4_33
      void v4
      const v7: number = input.f7_33
      void v7
      return { tool: 33, input }
    },
  }),
  defineTool({
    name: "tool_34",
    description: "Generated tool 34",
    input: z.object({
      f2_34: z.enum(["a", "b", "c"]),
      f5_34: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_34: z.string().min(1),
    }),
    handler: (input) => {
      const v2: "a" | "b" | "c" = input.f2_34
      void v2
      const v5: { x: number; y: string | null } = input.f5_34
      void v5
      const v0: string = input.f0_34
      void v0
      return { tool: 34, input }
    },
  }),
  defineTool({
    name: "tool_35",
    description: "Generated tool 35",
    input: z.object({
      f3_35: z.string().optional(),
      f6_35: z.boolean().default(false),
      f1_35: z.number().int().default(5),
    }),
    handler: (input) => {
      const v3: string | undefined = input.f3_35
      void v3
      const v6: boolean = input.f6_35
      void v6
      const v1: number = input.f1_35
      void v1
      return { tool: 35, input }
    },
  }),
  defineTool({
    name: "tool_36",
    description: "Generated tool 36",
    input: z.object({
      f4_36: z.array(z.string()).max(10),
      f7_36: z.string().transform((s) => s.length),
      f2_36: z.enum(["a", "b", "c"]),
    }),
    handler: (input) => {
      const v4: string[] = input.f4_36
      void v4
      const v7: number = input.f7_36
      void v7
      const v2: "a" | "b" | "c" = input.f2_36
      void v2
      return { tool: 36, input }
    },
  }),
  defineTool({
    name: "tool_37",
    description: "Generated tool 37",
    input: z.object({
      f5_37: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_37: z.string().min(1),
      f3_37: z.string().optional(),
    }),
    handler: (input) => {
      const v5: { x: number; y: string | null } = input.f5_37
      void v5
      const v0: string = input.f0_37
      void v0
      const v3: string | undefined = input.f3_37
      void v3
      return { tool: 37, input }
    },
  }),
  defineTool({
    name: "tool_38",
    description: "Generated tool 38",
    input: z.object({
      f6_38: z.boolean().default(false),
      f1_38: z.number().int().default(5),
      f4_38: z.array(z.string()).max(10),
    }),
    handler: (input) => {
      const v6: boolean = input.f6_38
      void v6
      const v1: number = input.f1_38
      void v1
      const v4: string[] = input.f4_38
      void v4
      return { tool: 38, input }
    },
  }),
  defineTool({
    name: "tool_39",
    description: "Generated tool 39",
    input: z.object({
      f7_39: z.string().transform((s) => s.length),
      f2_39: z.enum(["a", "b", "c"]),
      f5_39: z.object({ x: z.number(), y: z.string().nullable() }),
    }),
    handler: (input) => {
      const v7: number = input.f7_39
      void v7
      const v2: "a" | "b" | "c" = input.f2_39
      void v2
      const v5: { x: number; y: string | null } = input.f5_39
      void v5
      return { tool: 39, input }
    },
  }),
  defineTool({
    name: "tool_40",
    description: "Generated tool 40",
    input: z.object({
      f0_40: z.string().min(1),
      f3_40: z.string().optional(),
      f6_40: z.boolean().default(false),
    }),
    handler: (input) => {
      const v0: string = input.f0_40
      void v0
      const v3: string | undefined = input.f3_40
      void v3
      const v6: boolean = input.f6_40
      void v6
      return { tool: 40, input }
    },
  }),
  defineTool({
    name: "tool_41",
    description: "Generated tool 41",
    input: z.object({
      f1_41: z.number().int().default(5),
      f4_41: z.array(z.string()).max(10),
      f7_41: z.string().transform((s) => s.length),
    }),
    handler: (input) => {
      const v1: number = input.f1_41
      void v1
      const v4: string[] = input.f4_41
      void v4
      const v7: number = input.f7_41
      void v7
      return { tool: 41, input }
    },
  }),
  defineTool({
    name: "tool_42",
    description: "Generated tool 42",
    input: z.object({
      f2_42: z.enum(["a", "b", "c"]),
      f5_42: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_42: z.string().min(1),
    }),
    handler: (input) => {
      const v2: "a" | "b" | "c" = input.f2_42
      void v2
      const v5: { x: number; y: string | null } = input.f5_42
      void v5
      const v0: string = input.f0_42
      void v0
      return { tool: 42, input }
    },
  }),
  defineTool({
    name: "tool_43",
    description: "Generated tool 43",
    input: z.object({
      f3_43: z.string().optional(),
      f6_43: z.boolean().default(false),
      f1_43: z.number().int().default(5),
    }),
    handler: (input) => {
      const v3: string | undefined = input.f3_43
      void v3
      const v6: boolean = input.f6_43
      void v6
      const v1: number = input.f1_43
      void v1
      return { tool: 43, input }
    },
  }),
  defineTool({
    name: "tool_44",
    description: "Generated tool 44",
    input: z.object({
      f4_44: z.array(z.string()).max(10),
      f7_44: z.string().transform((s) => s.length),
      f2_44: z.enum(["a", "b", "c"]),
    }),
    handler: (input) => {
      const v4: string[] = input.f4_44
      void v4
      const v7: number = input.f7_44
      void v7
      const v2: "a" | "b" | "c" = input.f2_44
      void v2
      return { tool: 44, input }
    },
  }),
  defineTool({
    name: "tool_45",
    description: "Generated tool 45",
    input: z.object({
      f5_45: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_45: z.string().min(1),
      f3_45: z.string().optional(),
    }),
    handler: (input) => {
      const v5: { x: number; y: string | null } = input.f5_45
      void v5
      const v0: string = input.f0_45
      void v0
      const v3: string | undefined = input.f3_45
      void v3
      return { tool: 45, input }
    },
  }),
  defineTool({
    name: "tool_46",
    description: "Generated tool 46",
    input: z.object({
      f6_46: z.boolean().default(false),
      f1_46: z.number().int().default(5),
      f4_46: z.array(z.string()).max(10),
    }),
    handler: (input) => {
      const v6: boolean = input.f6_46
      void v6
      const v1: number = input.f1_46
      void v1
      const v4: string[] = input.f4_46
      void v4
      return { tool: 46, input }
    },
  }),
  defineTool({
    name: "tool_47",
    description: "Generated tool 47",
    input: z.object({
      f7_47: z.string().transform((s) => s.length),
      f2_47: z.enum(["a", "b", "c"]),
      f5_47: z.object({ x: z.number(), y: z.string().nullable() }),
    }),
    handler: (input) => {
      const v7: number = input.f7_47
      void v7
      const v2: "a" | "b" | "c" = input.f2_47
      void v2
      const v5: { x: number; y: string | null } = input.f5_47
      void v5
      return { tool: 47, input }
    },
  }),
  defineTool({
    name: "tool_48",
    description: "Generated tool 48",
    input: z.object({
      f0_48: z.string().min(1),
      f3_48: z.string().optional(),
      f6_48: z.boolean().default(false),
    }),
    handler: (input) => {
      const v0: string = input.f0_48
      void v0
      const v3: string | undefined = input.f3_48
      void v3
      const v6: boolean = input.f6_48
      void v6
      return { tool: 48, input }
    },
  }),
  defineTool({
    name: "tool_49",
    description: "Generated tool 49",
    input: z.object({
      f1_49: z.number().int().default(5),
      f4_49: z.array(z.string()).max(10),
      f7_49: z.string().transform((s) => s.length),
    }),
    handler: (input) => {
      const v1: number = input.f1_49
      void v1
      const v4: string[] = input.f4_49
      void v4
      const v7: number = input.f7_49
      void v7
      return { tool: 49, input }
    },
  }),
  defineTool({
    name: "tool_50",
    description: "Generated tool 50",
    input: z.object({
      f2_50: z.enum(["a", "b", "c"]),
      f5_50: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_50: z.string().min(1),
    }),
    handler: (input) => {
      const v2: "a" | "b" | "c" = input.f2_50
      void v2
      const v5: { x: number; y: string | null } = input.f5_50
      void v5
      const v0: string = input.f0_50
      void v0
      return { tool: 50, input }
    },
  }),
  defineTool({
    name: "tool_51",
    description: "Generated tool 51",
    input: z.object({
      f3_51: z.string().optional(),
      f6_51: z.boolean().default(false),
      f1_51: z.number().int().default(5),
    }),
    handler: (input) => {
      const v3: string | undefined = input.f3_51
      void v3
      const v6: boolean = input.f6_51
      void v6
      const v1: number = input.f1_51
      void v1
      return { tool: 51, input }
    },
  }),
  defineTool({
    name: "tool_52",
    description: "Generated tool 52",
    input: z.object({
      f4_52: z.array(z.string()).max(10),
      f7_52: z.string().transform((s) => s.length),
      f2_52: z.enum(["a", "b", "c"]),
    }),
    handler: (input) => {
      const v4: string[] = input.f4_52
      void v4
      const v7: number = input.f7_52
      void v7
      const v2: "a" | "b" | "c" = input.f2_52
      void v2
      return { tool: 52, input }
    },
  }),
  defineTool({
    name: "tool_53",
    description: "Generated tool 53",
    input: z.object({
      f5_53: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_53: z.string().min(1),
      f3_53: z.string().optional(),
    }),
    handler: (input) => {
      const v5: { x: number; y: string | null } = input.f5_53
      void v5
      const v0: string = input.f0_53
      void v0
      const v3: string | undefined = input.f3_53
      void v3
      return { tool: 53, input }
    },
  }),
  defineTool({
    name: "tool_54",
    description: "Generated tool 54",
    input: z.object({
      f6_54: z.boolean().default(false),
      f1_54: z.number().int().default(5),
      f4_54: z.array(z.string()).max(10),
    }),
    handler: (input) => {
      const v6: boolean = input.f6_54
      void v6
      const v1: number = input.f1_54
      void v1
      const v4: string[] = input.f4_54
      void v4
      return { tool: 54, input }
    },
  }),
  defineTool({
    name: "tool_55",
    description: "Generated tool 55",
    input: z.object({
      f7_55: z.string().transform((s) => s.length),
      f2_55: z.enum(["a", "b", "c"]),
      f5_55: z.object({ x: z.number(), y: z.string().nullable() }),
    }),
    handler: (input) => {
      const v7: number = input.f7_55
      void v7
      const v2: "a" | "b" | "c" = input.f2_55
      void v2
      const v5: { x: number; y: string | null } = input.f5_55
      void v5
      return { tool: 55, input }
    },
  }),
  defineTool({
    name: "tool_56",
    description: "Generated tool 56",
    input: z.object({
      f0_56: z.string().min(1),
      f3_56: z.string().optional(),
      f6_56: z.boolean().default(false),
    }),
    handler: (input) => {
      const v0: string = input.f0_56
      void v0
      const v3: string | undefined = input.f3_56
      void v3
      const v6: boolean = input.f6_56
      void v6
      return { tool: 56, input }
    },
  }),
  defineTool({
    name: "tool_57",
    description: "Generated tool 57",
    input: z.object({
      f1_57: z.number().int().default(5),
      f4_57: z.array(z.string()).max(10),
      f7_57: z.string().transform((s) => s.length),
    }),
    handler: (input) => {
      const v1: number = input.f1_57
      void v1
      const v4: string[] = input.f4_57
      void v4
      const v7: number = input.f7_57
      void v7
      return { tool: 57, input }
    },
  }),
  defineTool({
    name: "tool_58",
    description: "Generated tool 58",
    input: z.object({
      f2_58: z.enum(["a", "b", "c"]),
      f5_58: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_58: z.string().min(1),
    }),
    handler: (input) => {
      const v2: "a" | "b" | "c" = input.f2_58
      void v2
      const v5: { x: number; y: string | null } = input.f5_58
      void v5
      const v0: string = input.f0_58
      void v0
      return { tool: 58, input }
    },
  }),
  defineTool({
    name: "tool_59",
    description: "Generated tool 59",
    input: z.object({
      f3_59: z.string().optional(),
      f6_59: z.boolean().default(false),
      f1_59: z.number().int().default(5),
    }),
    handler: (input) => {
      const v3: string | undefined = input.f3_59
      void v3
      const v6: boolean = input.f6_59
      void v6
      const v1: number = input.f1_59
      void v1
      return { tool: 59, input }
    },
  }),
  defineTool({
    name: "tool_60",
    description: "Generated tool 60",
    input: z.object({
      f4_60: z.array(z.string()).max(10),
      f7_60: z.string().transform((s) => s.length),
      f2_60: z.enum(["a", "b", "c"]),
    }),
    handler: (input) => {
      const v4: string[] = input.f4_60
      void v4
      const v7: number = input.f7_60
      void v7
      const v2: "a" | "b" | "c" = input.f2_60
      void v2
      return { tool: 60, input }
    },
  }),
  defineTool({
    name: "tool_61",
    description: "Generated tool 61",
    input: z.object({
      f5_61: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_61: z.string().min(1),
      f3_61: z.string().optional(),
    }),
    handler: (input) => {
      const v5: { x: number; y: string | null } = input.f5_61
      void v5
      const v0: string = input.f0_61
      void v0
      const v3: string | undefined = input.f3_61
      void v3
      return { tool: 61, input }
    },
  }),
  defineTool({
    name: "tool_62",
    description: "Generated tool 62",
    input: z.object({
      f6_62: z.boolean().default(false),
      f1_62: z.number().int().default(5),
      f4_62: z.array(z.string()).max(10),
    }),
    handler: (input) => {
      const v6: boolean = input.f6_62
      void v6
      const v1: number = input.f1_62
      void v1
      const v4: string[] = input.f4_62
      void v4
      return { tool: 62, input }
    },
  }),
  defineTool({
    name: "tool_63",
    description: "Generated tool 63",
    input: z.object({
      f7_63: z.string().transform((s) => s.length),
      f2_63: z.enum(["a", "b", "c"]),
      f5_63: z.object({ x: z.number(), y: z.string().nullable() }),
    }),
    handler: (input) => {
      const v7: number = input.f7_63
      void v7
      const v2: "a" | "b" | "c" = input.f2_63
      void v2
      const v5: { x: number; y: string | null } = input.f5_63
      void v5
      return { tool: 63, input }
    },
  }),
  defineTool({
    name: "tool_64",
    description: "Generated tool 64",
    input: z.object({
      f0_64: z.string().min(1),
      f3_64: z.string().optional(),
      f6_64: z.boolean().default(false),
    }),
    handler: (input) => {
      const v0: string = input.f0_64
      void v0
      const v3: string | undefined = input.f3_64
      void v3
      const v6: boolean = input.f6_64
      void v6
      return { tool: 64, input }
    },
  }),
  defineTool({
    name: "tool_65",
    description: "Generated tool 65",
    input: z.object({
      f1_65: z.number().int().default(5),
      f4_65: z.array(z.string()).max(10),
      f7_65: z.string().transform((s) => s.length),
    }),
    handler: (input) => {
      const v1: number = input.f1_65
      void v1
      const v4: string[] = input.f4_65
      void v4
      const v7: number = input.f7_65
      void v7
      return { tool: 65, input }
    },
  }),
  defineTool({
    name: "tool_66",
    description: "Generated tool 66",
    input: z.object({
      f2_66: z.enum(["a", "b", "c"]),
      f5_66: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_66: z.string().min(1),
    }),
    handler: (input) => {
      const v2: "a" | "b" | "c" = input.f2_66
      void v2
      const v5: { x: number; y: string | null } = input.f5_66
      void v5
      const v0: string = input.f0_66
      void v0
      return { tool: 66, input }
    },
  }),
  defineTool({
    name: "tool_67",
    description: "Generated tool 67",
    input: z.object({
      f3_67: z.string().optional(),
      f6_67: z.boolean().default(false),
      f1_67: z.number().int().default(5),
    }),
    handler: (input) => {
      const v3: string | undefined = input.f3_67
      void v3
      const v6: boolean = input.f6_67
      void v6
      const v1: number = input.f1_67
      void v1
      return { tool: 67, input }
    },
  }),
  defineTool({
    name: "tool_68",
    description: "Generated tool 68",
    input: z.object({
      f4_68: z.array(z.string()).max(10),
      f7_68: z.string().transform((s) => s.length),
      f2_68: z.enum(["a", "b", "c"]),
    }),
    handler: (input) => {
      const v4: string[] = input.f4_68
      void v4
      const v7: number = input.f7_68
      void v7
      const v2: "a" | "b" | "c" = input.f2_68
      void v2
      return { tool: 68, input }
    },
  }),
  defineTool({
    name: "tool_69",
    description: "Generated tool 69",
    input: z.object({
      f5_69: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_69: z.string().min(1),
      f3_69: z.string().optional(),
    }),
    handler: (input) => {
      const v5: { x: number; y: string | null } = input.f5_69
      void v5
      const v0: string = input.f0_69
      void v0
      const v3: string | undefined = input.f3_69
      void v3
      return { tool: 69, input }
    },
  }),
  defineTool({
    name: "tool_70",
    description: "Generated tool 70",
    input: z.object({
      f6_70: z.boolean().default(false),
      f1_70: z.number().int().default(5),
      f4_70: z.array(z.string()).max(10),
    }),
    handler: (input) => {
      const v6: boolean = input.f6_70
      void v6
      const v1: number = input.f1_70
      void v1
      const v4: string[] = input.f4_70
      void v4
      return { tool: 70, input }
    },
  }),
  defineTool({
    name: "tool_71",
    description: "Generated tool 71",
    input: z.object({
      f7_71: z.string().transform((s) => s.length),
      f2_71: z.enum(["a", "b", "c"]),
      f5_71: z.object({ x: z.number(), y: z.string().nullable() }),
    }),
    handler: (input) => {
      const v7: number = input.f7_71
      void v7
      const v2: "a" | "b" | "c" = input.f2_71
      void v2
      const v5: { x: number; y: string | null } = input.f5_71
      void v5
      return { tool: 71, input }
    },
  }),
  defineTool({
    name: "tool_72",
    description: "Generated tool 72",
    input: z.object({
      f0_72: z.string().min(1),
      f3_72: z.string().optional(),
      f6_72: z.boolean().default(false),
    }),
    handler: (input) => {
      const v0: string = input.f0_72
      void v0
      const v3: string | undefined = input.f3_72
      void v3
      const v6: boolean = input.f6_72
      void v6
      return { tool: 72, input }
    },
  }),
  defineTool({
    name: "tool_73",
    description: "Generated tool 73",
    input: z.object({
      f1_73: z.number().int().default(5),
      f4_73: z.array(z.string()).max(10),
      f7_73: z.string().transform((s) => s.length),
    }),
    handler: (input) => {
      const v1: number = input.f1_73
      void v1
      const v4: string[] = input.f4_73
      void v4
      const v7: number = input.f7_73
      void v7
      return { tool: 73, input }
    },
  }),
  defineTool({
    name: "tool_74",
    description: "Generated tool 74",
    input: z.object({
      f2_74: z.enum(["a", "b", "c"]),
      f5_74: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_74: z.string().min(1),
    }),
    handler: (input) => {
      const v2: "a" | "b" | "c" = input.f2_74
      void v2
      const v5: { x: number; y: string | null } = input.f5_74
      void v5
      const v0: string = input.f0_74
      void v0
      return { tool: 74, input }
    },
  }),
  defineTool({
    name: "tool_75",
    description: "Generated tool 75",
    input: z.object({
      f3_75: z.string().optional(),
      f6_75: z.boolean().default(false),
      f1_75: z.number().int().default(5),
    }),
    handler: (input) => {
      const v3: string | undefined = input.f3_75
      void v3
      const v6: boolean = input.f6_75
      void v6
      const v1: number = input.f1_75
      void v1
      return { tool: 75, input }
    },
  }),
  defineTool({
    name: "tool_76",
    description: "Generated tool 76",
    input: z.object({
      f4_76: z.array(z.string()).max(10),
      f7_76: z.string().transform((s) => s.length),
      f2_76: z.enum(["a", "b", "c"]),
    }),
    handler: (input) => {
      const v4: string[] = input.f4_76
      void v4
      const v7: number = input.f7_76
      void v7
      const v2: "a" | "b" | "c" = input.f2_76
      void v2
      return { tool: 76, input }
    },
  }),
  defineTool({
    name: "tool_77",
    description: "Generated tool 77",
    input: z.object({
      f5_77: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_77: z.string().min(1),
      f3_77: z.string().optional(),
    }),
    handler: (input) => {
      const v5: { x: number; y: string | null } = input.f5_77
      void v5
      const v0: string = input.f0_77
      void v0
      const v3: string | undefined = input.f3_77
      void v3
      return { tool: 77, input }
    },
  }),
  defineTool({
    name: "tool_78",
    description: "Generated tool 78",
    input: z.object({
      f6_78: z.boolean().default(false),
      f1_78: z.number().int().default(5),
      f4_78: z.array(z.string()).max(10),
    }),
    handler: (input) => {
      const v6: boolean = input.f6_78
      void v6
      const v1: number = input.f1_78
      void v1
      const v4: string[] = input.f4_78
      void v4
      return { tool: 78, input }
    },
  }),
  defineTool({
    name: "tool_79",
    description: "Generated tool 79",
    input: z.object({
      f7_79: z.string().transform((s) => s.length),
      f2_79: z.enum(["a", "b", "c"]),
      f5_79: z.object({ x: z.number(), y: z.string().nullable() }),
    }),
    handler: (input) => {
      const v7: number = input.f7_79
      void v7
      const v2: "a" | "b" | "c" = input.f2_79
      void v2
      const v5: { x: number; y: string | null } = input.f5_79
      void v5
      return { tool: 79, input }
    },
  }),
  defineTool({
    name: "tool_80",
    description: "Generated tool 80",
    input: z.object({
      f0_80: z.string().min(1),
      f3_80: z.string().optional(),
      f6_80: z.boolean().default(false),
    }),
    handler: (input) => {
      const v0: string = input.f0_80
      void v0
      const v3: string | undefined = input.f3_80
      void v3
      const v6: boolean = input.f6_80
      void v6
      return { tool: 80, input }
    },
  }),
  defineTool({
    name: "tool_81",
    description: "Generated tool 81",
    input: z.object({
      f1_81: z.number().int().default(5),
      f4_81: z.array(z.string()).max(10),
      f7_81: z.string().transform((s) => s.length),
    }),
    handler: (input) => {
      const v1: number = input.f1_81
      void v1
      const v4: string[] = input.f4_81
      void v4
      const v7: number = input.f7_81
      void v7
      return { tool: 81, input }
    },
  }),
  defineTool({
    name: "tool_82",
    description: "Generated tool 82",
    input: z.object({
      f2_82: z.enum(["a", "b", "c"]),
      f5_82: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_82: z.string().min(1),
    }),
    handler: (input) => {
      const v2: "a" | "b" | "c" = input.f2_82
      void v2
      const v5: { x: number; y: string | null } = input.f5_82
      void v5
      const v0: string = input.f0_82
      void v0
      return { tool: 82, input }
    },
  }),
  defineTool({
    name: "tool_83",
    description: "Generated tool 83",
    input: z.object({
      f3_83: z.string().optional(),
      f6_83: z.boolean().default(false),
      f1_83: z.number().int().default(5),
    }),
    handler: (input) => {
      const v3: string | undefined = input.f3_83
      void v3
      const v6: boolean = input.f6_83
      void v6
      const v1: number = input.f1_83
      void v1
      return { tool: 83, input }
    },
  }),
  defineTool({
    name: "tool_84",
    description: "Generated tool 84",
    input: z.object({
      f4_84: z.array(z.string()).max(10),
      f7_84: z.string().transform((s) => s.length),
      f2_84: z.enum(["a", "b", "c"]),
    }),
    handler: (input) => {
      const v4: string[] = input.f4_84
      void v4
      const v7: number = input.f7_84
      void v7
      const v2: "a" | "b" | "c" = input.f2_84
      void v2
      return { tool: 84, input }
    },
  }),
  defineTool({
    name: "tool_85",
    description: "Generated tool 85",
    input: z.object({
      f5_85: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_85: z.string().min(1),
      f3_85: z.string().optional(),
    }),
    handler: (input) => {
      const v5: { x: number; y: string | null } = input.f5_85
      void v5
      const v0: string = input.f0_85
      void v0
      const v3: string | undefined = input.f3_85
      void v3
      return { tool: 85, input }
    },
  }),
  defineTool({
    name: "tool_86",
    description: "Generated tool 86",
    input: z.object({
      f6_86: z.boolean().default(false),
      f1_86: z.number().int().default(5),
      f4_86: z.array(z.string()).max(10),
    }),
    handler: (input) => {
      const v6: boolean = input.f6_86
      void v6
      const v1: number = input.f1_86
      void v1
      const v4: string[] = input.f4_86
      void v4
      return { tool: 86, input }
    },
  }),
  defineTool({
    name: "tool_87",
    description: "Generated tool 87",
    input: z.object({
      f7_87: z.string().transform((s) => s.length),
      f2_87: z.enum(["a", "b", "c"]),
      f5_87: z.object({ x: z.number(), y: z.string().nullable() }),
    }),
    handler: (input) => {
      const v7: number = input.f7_87
      void v7
      const v2: "a" | "b" | "c" = input.f2_87
      void v2
      const v5: { x: number; y: string | null } = input.f5_87
      void v5
      return { tool: 87, input }
    },
  }),
  defineTool({
    name: "tool_88",
    description: "Generated tool 88",
    input: z.object({
      f0_88: z.string().min(1),
      f3_88: z.string().optional(),
      f6_88: z.boolean().default(false),
    }),
    handler: (input) => {
      const v0: string = input.f0_88
      void v0
      const v3: string | undefined = input.f3_88
      void v3
      const v6: boolean = input.f6_88
      void v6
      return { tool: 88, input }
    },
  }),
  defineTool({
    name: "tool_89",
    description: "Generated tool 89",
    input: z.object({
      f1_89: z.number().int().default(5),
      f4_89: z.array(z.string()).max(10),
      f7_89: z.string().transform((s) => s.length),
    }),
    handler: (input) => {
      const v1: number = input.f1_89
      void v1
      const v4: string[] = input.f4_89
      void v4
      const v7: number = input.f7_89
      void v7
      return { tool: 89, input }
    },
  }),
  defineTool({
    name: "tool_90",
    description: "Generated tool 90",
    input: z.object({
      f2_90: z.enum(["a", "b", "c"]),
      f5_90: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_90: z.string().min(1),
    }),
    handler: (input) => {
      const v2: "a" | "b" | "c" = input.f2_90
      void v2
      const v5: { x: number; y: string | null } = input.f5_90
      void v5
      const v0: string = input.f0_90
      void v0
      return { tool: 90, input }
    },
  }),
  defineTool({
    name: "tool_91",
    description: "Generated tool 91",
    input: z.object({
      f3_91: z.string().optional(),
      f6_91: z.boolean().default(false),
      f1_91: z.number().int().default(5),
    }),
    handler: (input) => {
      const v3: string | undefined = input.f3_91
      void v3
      const v6: boolean = input.f6_91
      void v6
      const v1: number = input.f1_91
      void v1
      return { tool: 91, input }
    },
  }),
  defineTool({
    name: "tool_92",
    description: "Generated tool 92",
    input: z.object({
      f4_92: z.array(z.string()).max(10),
      f7_92: z.string().transform((s) => s.length),
      f2_92: z.enum(["a", "b", "c"]),
    }),
    handler: (input) => {
      const v4: string[] = input.f4_92
      void v4
      const v7: number = input.f7_92
      void v7
      const v2: "a" | "b" | "c" = input.f2_92
      void v2
      return { tool: 92, input }
    },
  }),
  defineTool({
    name: "tool_93",
    description: "Generated tool 93",
    input: z.object({
      f5_93: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_93: z.string().min(1),
      f3_93: z.string().optional(),
    }),
    handler: (input) => {
      const v5: { x: number; y: string | null } = input.f5_93
      void v5
      const v0: string = input.f0_93
      void v0
      const v3: string | undefined = input.f3_93
      void v3
      return { tool: 93, input }
    },
  }),
  defineTool({
    name: "tool_94",
    description: "Generated tool 94",
    input: z.object({
      f6_94: z.boolean().default(false),
      f1_94: z.number().int().default(5),
      f4_94: z.array(z.string()).max(10),
    }),
    handler: (input) => {
      const v6: boolean = input.f6_94
      void v6
      const v1: number = input.f1_94
      void v1
      const v4: string[] = input.f4_94
      void v4
      return { tool: 94, input }
    },
  }),
  defineTool({
    name: "tool_95",
    description: "Generated tool 95",
    input: z.object({
      f7_95: z.string().transform((s) => s.length),
      f2_95: z.enum(["a", "b", "c"]),
      f5_95: z.object({ x: z.number(), y: z.string().nullable() }),
    }),
    handler: (input) => {
      const v7: number = input.f7_95
      void v7
      const v2: "a" | "b" | "c" = input.f2_95
      void v2
      const v5: { x: number; y: string | null } = input.f5_95
      void v5
      return { tool: 95, input }
    },
  }),
  defineTool({
    name: "tool_96",
    description: "Generated tool 96",
    input: z.object({
      f0_96: z.string().min(1),
      f3_96: z.string().optional(),
      f6_96: z.boolean().default(false),
    }),
    handler: (input) => {
      const v0: string = input.f0_96
      void v0
      const v3: string | undefined = input.f3_96
      void v3
      const v6: boolean = input.f6_96
      void v6
      return { tool: 96, input }
    },
  }),
  defineTool({
    name: "tool_97",
    description: "Generated tool 97",
    input: z.object({
      f1_97: z.number().int().default(5),
      f4_97: z.array(z.string()).max(10),
      f7_97: z.string().transform((s) => s.length),
    }),
    handler: (input) => {
      const v1: number = input.f1_97
      void v1
      const v4: string[] = input.f4_97
      void v4
      const v7: number = input.f7_97
      void v7
      return { tool: 97, input }
    },
  }),
  defineTool({
    name: "tool_98",
    description: "Generated tool 98",
    input: z.object({
      f2_98: z.enum(["a", "b", "c"]),
      f5_98: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_98: z.string().min(1),
    }),
    handler: (input) => {
      const v2: "a" | "b" | "c" = input.f2_98
      void v2
      const v5: { x: number; y: string | null } = input.f5_98
      void v5
      const v0: string = input.f0_98
      void v0
      return { tool: 98, input }
    },
  }),
  defineTool({
    name: "tool_99",
    description: "Generated tool 99",
    input: z.object({
      f3_99: z.string().optional(),
      f6_99: z.boolean().default(false),
      f1_99: z.number().int().default(5),
    }),
    handler: (input) => {
      const v3: string | undefined = input.f3_99
      void v3
      const v6: boolean = input.f6_99
      void v6
      const v1: number = input.f1_99
      void v1
      return { tool: 99, input }
    },
  }),
  defineTool({
    name: "tool_100",
    description: "Generated tool 100",
    input: z.object({
      f4_100: z.array(z.string()).max(10),
      f7_100: z.string().transform((s) => s.length),
      f2_100: z.enum(["a", "b", "c"]),
    }),
    handler: (input) => {
      const v4: string[] = input.f4_100
      void v4
      const v7: number = input.f7_100
      void v7
      const v2: "a" | "b" | "c" = input.f2_100
      void v2
      return { tool: 100, input }
    },
  }),
  defineTool({
    name: "tool_101",
    description: "Generated tool 101",
    input: z.object({
      f5_101: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_101: z.string().min(1),
      f3_101: z.string().optional(),
    }),
    handler: (input) => {
      const v5: { x: number; y: string | null } = input.f5_101
      void v5
      const v0: string = input.f0_101
      void v0
      const v3: string | undefined = input.f3_101
      void v3
      return { tool: 101, input }
    },
  }),
  defineTool({
    name: "tool_102",
    description: "Generated tool 102",
    input: z.object({
      f6_102: z.boolean().default(false),
      f1_102: z.number().int().default(5),
      f4_102: z.array(z.string()).max(10),
    }),
    handler: (input) => {
      const v6: boolean = input.f6_102
      void v6
      const v1: number = input.f1_102
      void v1
      const v4: string[] = input.f4_102
      void v4
      return { tool: 102, input }
    },
  }),
  defineTool({
    name: "tool_103",
    description: "Generated tool 103",
    input: z.object({
      f7_103: z.string().transform((s) => s.length),
      f2_103: z.enum(["a", "b", "c"]),
      f5_103: z.object({ x: z.number(), y: z.string().nullable() }),
    }),
    handler: (input) => {
      const v7: number = input.f7_103
      void v7
      const v2: "a" | "b" | "c" = input.f2_103
      void v2
      const v5: { x: number; y: string | null } = input.f5_103
      void v5
      return { tool: 103, input }
    },
  }),
  defineTool({
    name: "tool_104",
    description: "Generated tool 104",
    input: z.object({
      f0_104: z.string().min(1),
      f3_104: z.string().optional(),
      f6_104: z.boolean().default(false),
    }),
    handler: (input) => {
      const v0: string = input.f0_104
      void v0
      const v3: string | undefined = input.f3_104
      void v3
      const v6: boolean = input.f6_104
      void v6
      return { tool: 104, input }
    },
  }),
  defineTool({
    name: "tool_105",
    description: "Generated tool 105",
    input: z.object({
      f1_105: z.number().int().default(5),
      f4_105: z.array(z.string()).max(10),
      f7_105: z.string().transform((s) => s.length),
    }),
    handler: (input) => {
      const v1: number = input.f1_105
      void v1
      const v4: string[] = input.f4_105
      void v4
      const v7: number = input.f7_105
      void v7
      return { tool: 105, input }
    },
  }),
  defineTool({
    name: "tool_106",
    description: "Generated tool 106",
    input: z.object({
      f2_106: z.enum(["a", "b", "c"]),
      f5_106: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_106: z.string().min(1),
    }),
    handler: (input) => {
      const v2: "a" | "b" | "c" = input.f2_106
      void v2
      const v5: { x: number; y: string | null } = input.f5_106
      void v5
      const v0: string = input.f0_106
      void v0
      return { tool: 106, input }
    },
  }),
  defineTool({
    name: "tool_107",
    description: "Generated tool 107",
    input: z.object({
      f3_107: z.string().optional(),
      f6_107: z.boolean().default(false),
      f1_107: z.number().int().default(5),
    }),
    handler: (input) => {
      const v3: string | undefined = input.f3_107
      void v3
      const v6: boolean = input.f6_107
      void v6
      const v1: number = input.f1_107
      void v1
      return { tool: 107, input }
    },
  }),
  defineTool({
    name: "tool_108",
    description: "Generated tool 108",
    input: z.object({
      f4_108: z.array(z.string()).max(10),
      f7_108: z.string().transform((s) => s.length),
      f2_108: z.enum(["a", "b", "c"]),
    }),
    handler: (input) => {
      const v4: string[] = input.f4_108
      void v4
      const v7: number = input.f7_108
      void v7
      const v2: "a" | "b" | "c" = input.f2_108
      void v2
      return { tool: 108, input }
    },
  }),
  defineTool({
    name: "tool_109",
    description: "Generated tool 109",
    input: z.object({
      f5_109: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_109: z.string().min(1),
      f3_109: z.string().optional(),
    }),
    handler: (input) => {
      const v5: { x: number; y: string | null } = input.f5_109
      void v5
      const v0: string = input.f0_109
      void v0
      const v3: string | undefined = input.f3_109
      void v3
      return { tool: 109, input }
    },
  }),
  defineTool({
    name: "tool_110",
    description: "Generated tool 110",
    input: z.object({
      f6_110: z.boolean().default(false),
      f1_110: z.number().int().default(5),
      f4_110: z.array(z.string()).max(10),
    }),
    handler: (input) => {
      const v6: boolean = input.f6_110
      void v6
      const v1: number = input.f1_110
      void v1
      const v4: string[] = input.f4_110
      void v4
      return { tool: 110, input }
    },
  }),
  defineTool({
    name: "tool_111",
    description: "Generated tool 111",
    input: z.object({
      f7_111: z.string().transform((s) => s.length),
      f2_111: z.enum(["a", "b", "c"]),
      f5_111: z.object({ x: z.number(), y: z.string().nullable() }),
    }),
    handler: (input) => {
      const v7: number = input.f7_111
      void v7
      const v2: "a" | "b" | "c" = input.f2_111
      void v2
      const v5: { x: number; y: string | null } = input.f5_111
      void v5
      return { tool: 111, input }
    },
  }),
  defineTool({
    name: "tool_112",
    description: "Generated tool 112",
    input: z.object({
      f0_112: z.string().min(1),
      f3_112: z.string().optional(),
      f6_112: z.boolean().default(false),
    }),
    handler: (input) => {
      const v0: string = input.f0_112
      void v0
      const v3: string | undefined = input.f3_112
      void v3
      const v6: boolean = input.f6_112
      void v6
      return { tool: 112, input }
    },
  }),
  defineTool({
    name: "tool_113",
    description: "Generated tool 113",
    input: z.object({
      f1_113: z.number().int().default(5),
      f4_113: z.array(z.string()).max(10),
      f7_113: z.string().transform((s) => s.length),
    }),
    handler: (input) => {
      const v1: number = input.f1_113
      void v1
      const v4: string[] = input.f4_113
      void v4
      const v7: number = input.f7_113
      void v7
      return { tool: 113, input }
    },
  }),
  defineTool({
    name: "tool_114",
    description: "Generated tool 114",
    input: z.object({
      f2_114: z.enum(["a", "b", "c"]),
      f5_114: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_114: z.string().min(1),
    }),
    handler: (input) => {
      const v2: "a" | "b" | "c" = input.f2_114
      void v2
      const v5: { x: number; y: string | null } = input.f5_114
      void v5
      const v0: string = input.f0_114
      void v0
      return { tool: 114, input }
    },
  }),
  defineTool({
    name: "tool_115",
    description: "Generated tool 115",
    input: z.object({
      f3_115: z.string().optional(),
      f6_115: z.boolean().default(false),
      f1_115: z.number().int().default(5),
    }),
    handler: (input) => {
      const v3: string | undefined = input.f3_115
      void v3
      const v6: boolean = input.f6_115
      void v6
      const v1: number = input.f1_115
      void v1
      return { tool: 115, input }
    },
  }),
  defineTool({
    name: "tool_116",
    description: "Generated tool 116",
    input: z.object({
      f4_116: z.array(z.string()).max(10),
      f7_116: z.string().transform((s) => s.length),
      f2_116: z.enum(["a", "b", "c"]),
    }),
    handler: (input) => {
      const v4: string[] = input.f4_116
      void v4
      const v7: number = input.f7_116
      void v7
      const v2: "a" | "b" | "c" = input.f2_116
      void v2
      return { tool: 116, input }
    },
  }),
  defineTool({
    name: "tool_117",
    description: "Generated tool 117",
    input: z.object({
      f5_117: z.object({ x: z.number(), y: z.string().nullable() }),
      f0_117: z.string().min(1),
      f3_117: z.string().optional(),
    }),
    handler: (input) => {
      const v5: { x: number; y: string | null } = input.f5_117
      void v5
      const v0: string = input.f0_117
      void v0
      const v3: string | undefined = input.f3_117
      void v3
      return { tool: 117, input }
    },
  }),
  defineTool({
    name: "tool_118",
    description: "Generated tool 118",
    input: z.object({
      f6_118: z.boolean().default(false),
      f1_118: z.number().int().default(5),
      f4_118: z.array(z.string()).max(10),
    }),
    handler: (input) => {
      const v6: boolean = input.f6_118
      void v6
      const v1: number = input.f1_118
      void v1
      const v4: string[] = input.f4_118
      void v4
      return { tool: 118, input }
    },
  }),
  defineTool({
    name: "tool_119",
    description: "Generated tool 119",
    input: z.object({
      f7_119: z.string().transform((s) => s.length),
      f2_119: z.enum(["a", "b", "c"]),
      f5_119: z.object({ x: z.number(), y: z.string().nullable() }),
    }),
    handler: (input) => {
      const v7: number = input.f7_119
      void v7
      const v2: "a" | "b" | "c" = input.f2_119
      void v2
      const v5: { x: number; y: string | null } = input.f5_119
      void v5
      return { tool: 119, input }
    },
  }),
]
