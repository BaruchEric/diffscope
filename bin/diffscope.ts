#!/usr/bin/env bun
import { main } from "../src/server/cli";
main(process.argv.slice(2)).catch((err) => {
  console.error("diffscope:", err);
  process.exit(1);
});
