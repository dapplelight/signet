import { Field, FieldControl, FieldLabel } from "../../components/ui/field.js"
import type { OnboardingStep } from "./index.js"

/** Generic starting steps. Pass your own `steps`: each one's `content` is any React node. */
export const SAMPLE_STEPS: OnboardingStep[] = [
  {
    id: "profile",
    title: "Tell us about you",
    description: "Your name",
    content: (
      <Field>
        <FieldLabel>Full name</FieldLabel>
        <FieldControl name="name" autoComplete="name" className="h-11 md:h-8" />
      </Field>
    ),
  },
  {
    id: "workspace",
    title: "Create a workspace",
    description: "Where work lives",
    content: (
      <Field>
        <FieldLabel>Workspace name</FieldLabel>
        <FieldControl name="workspace" autoComplete="organization" className="h-11 md:h-8" />
      </Field>
    ),
  },
  {
    id: "invite",
    title: "Invite your team",
    description: "Optional",
    content: (
      <Field>
        <FieldLabel>Teammate email</FieldLabel>
        <FieldControl
          name="invite"
          type="email"
          autoComplete="off"
          placeholder="teammate@example.com"
          className="h-11 md:h-8"
        />
      </Field>
    ),
  },
]
