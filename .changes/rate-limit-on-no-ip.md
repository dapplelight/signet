### signet-server: choose what `rateLimit` does with a request that has no client IP

- New `onNoIp: "allow" | "reject" | "bucket"` on `rateLimit`. The default, `"bucket"`, is the old behaviour: every request without a usable IP shares one `no-ip` bucket, so once it fills (for example a proxy stops sending `cf-connecting-ip`) everyone without an IP gets 429. `"allow"` lets them through unlimited; `"reject"` answers 400 `BAD_REQUEST` without touching the store. Ignored when `keyFor` is given.
