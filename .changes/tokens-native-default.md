### signet-tokens: `./native` resolves under require

- The `./native` export has a `default` condition, so Jest and other CommonJS
  resolvers find it (React Native test setups failed to resolve it).
