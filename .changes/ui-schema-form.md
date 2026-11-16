### ui: SchemaForm, a form drawn from a zod schema

`@dapplelight/signet-ui/components/schema-form`: `<SchemaForm schema={Expense} onSubmit={save} />` renders every field with Signet's own controls (text, textarea, number, date, switch, select, nested objects and lists), wires labels, descriptions and errors through `Field`, and validates with the schema. Built on AutoForm's TanStack Form adapter.

- Customise a field in the schema with `fieldConfig` from `@autoform/zod` (label, description, control type, order, input props), or replace a control type for the whole form with `formComponents`; every part has a `data-slot`.
- `onSubmitError={(error, form) => applyServerErrors(form, error)}` puts signet-server's 422 field errors under their fields.
- Submit / add / remove text comes from `LabelsProvider` (`submit`, `addItem`, `removeItem`, `chooseOption`).
- Optional peers, only for apps that use it: `@autoform/react` ^5, `@autoform/zod` ^6, `@tanstack/react-form` ^1, `zod` ^4.
