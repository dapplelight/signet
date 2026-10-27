/**
 * Protected Resource Metadata — RFC 9728.
 *
 * Served at `/.well-known/oauth-protected-resource`. It is how an agent
 * discovers which authorization server to get a token from, and which audience
 * value to request. Without it a client cannot authenticate to you at all
 * except by out-of-band configuration.
 */

export type ProtectedResourceMetadata = {
  /** This server's canonical identifier — the value clients put in `resource`. */
  resource: string
  authorization_servers: string[]
  scopes_supported?: string[]
  bearer_methods_supported?: string[]
  resource_documentation?: string
  jwks_uri?: string
}

export type MetadataOptions = {
  resource: string
  authorizationServers: string[]
  scopesSupported?: string[]
  documentation?: string
}

export function protectedResourceMetadata(options: MetadataOptions): ProtectedResourceMetadata {
  return {
    resource: options.resource,
    authorization_servers: options.authorizationServers,
    ...(options.scopesSupported ? { scopes_supported: options.scopesSupported } : {}),
    // Header only. Tokens in query strings land in access logs, proxies and
    // browser history, so they are deliberately not advertised as supported.
    bearer_methods_supported: ["header"],
    ...(options.documentation ? { resource_documentation: options.documentation } : {}),
  }
}

/**
 * The `WWW-Authenticate` value for a 401, per RFC 6750 and RFC 9728.
 *
 * `resource_metadata` is what lets a client that got a 401 discover where to
 * obtain a valid token, instead of simply failing.
 */
export function wwwAuthenticate(args: {
  resourceMetadataUrl: string
  error?: "invalid_token" | "insufficient_scope"
  description?: string
  requiredScopes?: string[]
}): string {
  const parts = [`Bearer resource_metadata="${args.resourceMetadataUrl}"`]
  if (args.error) parts.push(`error="${args.error}"`)
  if (args.description) parts.push(`error_description="${args.description.replaceAll('"', "'")}"`)
  // Telling the client which scope it lacks is what makes step-up possible.
  if (args.requiredScopes?.length) parts.push(`scope="${args.requiredScopes.join(" ")}"`)
  return parts.join(", ")
}
