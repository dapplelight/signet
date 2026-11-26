### signet-ui: Table `scrollX` prop

- `Table` takes an opt-in `scrollX` prop (default `false`). When true, the wrapper gets `overflow-x-auto` so wide tables scroll sideways on phones. It is off by default because an `overflow` wrapper stops `position: sticky` headers from sticking to the page; default output is unchanged.
