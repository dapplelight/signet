/**
 * Apple Pay domain verification for gateways that hand you a file to host
 * (Razorpay, PayPal, Dodo Payments): Apple fetches it from this exact path,
 * over HTTPS, with no redirect. Stripe needs no file: register the domain with
 * `stripe.raw("POST", "/payment_method_domains", ...)` instead.
 * https://razorpay.com/docs/payments/payment-methods/apple-pay.md
 * https://developer.paypal.com/docs/checkout/apm/apple-pay/
 * https://docs.dodopayments.com/features/payment-methods/digital-wallets.md
 */

export const APPLE_PAY_DOMAIN_ASSOCIATION_PATH =
  "/.well-known/apple-developer-merchantid-domain-association"

/**
 * A handler serving the association file your gateway gave you. Returns null
 * for any other request, so it slots in front of an app's router:
 * `applePayDomainAssociation(file)(request) ?? app.fetch(request)`.
 */
export function applePayDomainAssociation(file: string): (request: Request) => Response | null {
  return (request) =>
    (request.method === "GET" || request.method === "HEAD") &&
    new URL(request.url).pathname === APPLE_PAY_DOMAIN_ASSOCIATION_PATH
      ? new Response(request.method === "HEAD" ? null : file)
      : null
}
