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
