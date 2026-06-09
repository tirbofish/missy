#!/usr/bin/env node --import tsx

import { execute } from "@oclif/core";

await execute({ development: true, dir: import.meta.url });
