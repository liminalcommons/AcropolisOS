import { z } from "zod";

export const PRIMITIVE_PROPERTY_TYPES = [
  "uuid",
  "string",
  "email",
  "date",
  "timestamp",
  "integer",
  "decimal",
  "boolean",
  "enum",
  "ref",
] as const;

export const PropertyPrimitiveType = z.enum(PRIMITIVE_PROPERTY_TYPES);
export type PropertyPrimitiveType = z.infer<typeof PropertyPrimitiveType>;

export const PermissionsBlock = z
  .object({
    read: z.array(z.string()).optional(),
    write: z.array(z.string()).optional(),
  })
  .strict();
export type PermissionsBlock = z.infer<typeof PermissionsBlock>;

const InlinePropertyBase = z.object({
  primary_key: z.boolean().optional(),
  description: z.string().optional(),
  permissions: PermissionsBlock.optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
});

const EnumProperty = InlinePropertyBase.extend({
  type: z.literal("enum"),
  values: z.array(z.string()).min(1, "enum must declare at least one value"),
});

const RefProperty = InlinePropertyBase.extend({
  type: z.literal("ref"),
  target: z.string().min(1, "ref must declare a target object-type"),
});

const ScalarProperty = InlinePropertyBase.extend({
  type: z.enum([
    "uuid",
    "string",
    "email",
    "date",
    "timestamp",
    "integer",
    "decimal",
    "boolean",
  ]),
});

export const InlineProperty = z.discriminatedUnion("type", [
  ScalarProperty,
  EnumProperty,
  RefProperty,
]);
export type InlineProperty = z.infer<typeof InlineProperty>;

export const PropertyReference = z
  .object({
    ref: z.string().min(1, "ref must name a shared property"),
    description: z.string().optional(),
    permissions: PermissionsBlock.optional(),
    required: z.boolean().optional(),
    primary_key: z.boolean().optional(),
  })
  .strict();
export type PropertyReference = z.infer<typeof PropertyReference>;

export const PropertyDefinition = z.union([InlineProperty, PropertyReference]);
export type PropertyDefinition = z.infer<typeof PropertyDefinition>;

export const SharedPropertyRegistry = z.record(z.string(), InlineProperty);
export type SharedPropertyRegistry = z.infer<typeof SharedPropertyRegistry>;

export const ObjectType = z
  .object({
    description: z.string().optional(),
    title_property: z.string().optional(),
    permissions: PermissionsBlock.optional(),
    // When true, codegen emits a Postgres trigger on the generated table that
    // mirrors every INSERT/UPDATE/DELETE into the generic data_audit table.
    // Opt-in per object type (US-034).
    data_audit: z.boolean().optional(),
    properties: z
      .record(z.string(), PropertyDefinition)
      .refine((props) => Object.keys(props).length > 0, {
        message: "object type must declare at least one property",
      }),
  })
  .strict();
export type ObjectType = z.infer<typeof ObjectType>;

export const LinkCardinality = z.enum([
  "one-to-one",
  "one-to-many",
  "many-to-many",
]);
export type LinkCardinality = z.infer<typeof LinkCardinality>;

export const LinkType = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    cardinality: LinkCardinality,
    description: z.string().optional(),
    properties: z.record(z.string(), PropertyDefinition).optional(),
    // When true, the injected FK column on the "to" side of a one-to-one or
    // one-to-many link is emitted as nullable (no .notNull()). Use when the
    // relationship is optional — e.g. a Bed that may or may not have an active
    // WorkTradeAgreement.
    fk_optional: z.boolean().optional(),
  })
  .strict();
export type LinkType = z.infer<typeof LinkType>;

export const AgentPolicy = z.enum([
  "auto_apply",
  "always_confirm",
  "confirm_if_unfamiliar",
]);
export type AgentPolicy = z.infer<typeof AgentPolicy>;

export const SideEffectChannel = z.enum([
  "audit",
  "notify_member",
  "notify_steward",
  "webhook",
]);
export type SideEffectChannel = z.infer<typeof SideEffectChannel>;

// Per-action override for side-effect channel config. Defaults come from
// the environment (US-028); the YAML override is for action-specific
// destinations (e.g. one webhook URL for add_member, another for change_tier).
export const SideEffectsConfig = z
  .object({
    webhook_url: z.string().optional(),
    steward_emails: z.array(z.string()).optional(),
  })
  .strict();
export type SideEffectsConfig = z.infer<typeof SideEffectsConfig>;

export const ActionType = z
  .object({
    description: z.string().optional(),
    creates_link: z.string().optional(),
    creates_object: z.string().optional(),
    updates: z.string().optional(),
    deletes: z.string().optional(),
    function: z.string().optional(),
    parameters: z.record(z.string(), PropertyDefinition).optional(),
    permissions: z.array(z.string()).optional(),
    agent_policy: AgentPolicy.default("always_confirm"),
    side_effects: z.array(SideEffectChannel).optional(),
    side_effects_config: SideEffectsConfig.optional(),
    // Opt-in: may this action surface as a ONE-CLICK row affordance on a
    // data_table (e.g. the steward's veto-queue "Dismiss")? Such affordances
    // invoke with bypassConfirmation=true, so this is a SECURITY declaration —
    // only actions explicitly marked here may be one-click-invoked. The
    // structural single-required-ref rule (lib/widgets/row-actions.ts) is
    // necessary but not sufficient; this flag gates which qualifying actions
    // are actually safe (excludes e.g. promote_to_steward, check_in/out).
    row_action: z.boolean().optional(),
    // Opt-in: may this action surface as a per-row CHOICE picker (a
    // "row_resolver") on a data_table — N buttons, one per curated option,
    // each binding a SECOND param to the chosen option's id? Unlike row_action
    // (a single-required-ref one-click), a resolver is choice-driven: the row
    // carries a JSON array of {id,label} in `choices_from`, and the chosen
    // option's id binds to `choice_param`. This declares the mapping in the
    // ONTOLOGY (governed, generalizable across any future choice-driven
    // action), not in code. SECURITY: like row_action this is an opt-in, and
    // the server gate additionally validates the chosen id is a MEMBER of the
    // row's curated choices before invoking.
    row_resolver: z
      .object({ choices_from: z.string(), choice_param: z.string() })
      .optional(),
    // Opt-in: may this action surface as a per-row BINARY CONFIRM (a
    // "row_confirm") on a data_table — a SINGLE "Confirm: <label>" button whose
    // invocation is DERIVED SERVER-SIDE from the row's own `source` column (a
    // JSON `{ label, action }`), the client supplying ONLY the row id? Unlike
    // row_resolver (N curated choices, client picks one of several), a confirm
    // is the agent's SINGLE proposed action: the steward says yes (Confirm) or
    // no (the existing Dismiss row_action). `source` names the row column
    // holding `{ label, action }`; `invocation_param` is the action param the
    // JSON-stringified `source.action` binds to. SECURITY: like the other
    // affordances this is an ontology opt-in, AND because the invocation is
    // server-derived from the row (never client-supplied) there is no injection
    // surface — the client cannot smuggle an arbitrary action.
    row_confirm: z
      .object({ source: z.string(), invocation_param: z.string() })
      .optional(),
  })
  .strict();
export type ActionType = z.infer<typeof ActionType>;

export const RoleDefinition = z
  .object({
    description: z.string().optional(),
    extends: z.string().optional(),
  })
  .strict();
export type RoleDefinition = z.infer<typeof RoleDefinition>;

export const Ontology = z.object({
  properties: SharedPropertyRegistry,
  roles: z.record(z.string(), RoleDefinition),
  object_types: z.record(z.string(), ObjectType),
  link_types: z.record(z.string(), LinkType),
  action_types: z.record(z.string(), ActionType),
});
export type Ontology = z.infer<typeof Ontology>;
